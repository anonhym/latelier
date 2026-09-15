/**
 * Reusable crash-fuzz harness. Copy into a scratchpad spec, add an action
 * alphabet and a fixture, run, then delete — never commit the driver itself
 * (see SKILL.md, "What gets committed").
 *
 * Everything here is surface-agnostic. The workspace-specific parts — which
 * actions exist, what the fixture seeds — belong in the driver, not here.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ElectronApplication, Page } from 'playwright';

// ─── seeded PRNG ────────────────────────────────────────────────────────
// A repro needs a seed. Note that a seed does NOT pin the trace when action
// eligibility is a live DOM probe — see SKILL.md, "Seeded is not
// deterministic". The logged trace is what replays.
export function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── oracle 1-3: the main process ───────────────────────────────────────
/**
 * All I/O in this app lives in the main process, so a renderer-only oracle
 * misses most of what can actually go wrong. This watches three things a
 * `console.error` listener cannot see: stderr, process death, and the
 * structured log file `electron/log.ts` writes.
 *
 * `consumed` makes `newErrors()` incremental, so a single pre-existing error
 * line is not re-reported after every subsequent step.
 */
export class MainOracle {
  stderr = '';
  died: number | null = null;
  private consumed = 0;
  private userDataDir: string;

  constructor(app: ElectronApplication, userDataDir: string) {
    this.userDataDir = userDataDir;
    const p = app.process();
    p.stderr?.on('data', (b: Buffer) => (this.stderr += b.toString()));
    p.on('exit', (code: number | null) => (this.died = code ?? -1));
  }

  private newErrors(): string[] {
    const dir = path.join(this.userDataDir, 'logs');
    if (!fs.existsSync(dir)) return [];
    const all = fs
      .readdirSync(dir)
      .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n'))
      .filter((l) => /"level":"(error|fatal)"/.test(l));
    const fresh = all.slice(this.consumed);
    this.consumed = all.length;
    return fresh;
  }

  check(where: string): string[] {
    const problems: string[] = [];
    if (this.died !== null) problems.push(`MAIN PROCESS DIED (code ${this.died}) at ${where}`);
    const errs = this.newErrors();
    if (errs.length) problems.push(`main-process error log at ${where}:\n${errs.join('\n')}`);
    const crashy = this.stderr
      .split('\n')
      .filter((l) => /Uncaught|UnhandledPromiseRejection|FATAL|Segmentation/i.test(l));
    if (crashy.length) problems.push(`main stderr crash at ${where}:\n${crashy.join('\n')}`);
    return problems;
  }
}

// ─── oracle 4: the renderer ─────────────────────────────────────────────
export function rendererOracle(win: Page) {
  const errors: string[] = [];
  win.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|DevTools/i.test(m.text())) errors.push(m.text());
  });
  win.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { drain: () => errors.splice(0) };
}

// ─── oracle 5: the data delta ───────────────────────────────────────────
/**
 * The one the crash oracles cannot replace. A wrong-target write returns
 * `{ok: true}` with nothing in any log — all four oracles above stay silent
 * while the wrong collection is emptied. Read ground truth straight off the
 * bridge, before and after, and compare against an explicit expectation.
 *
 * Seed the SAME collection name into two databases so a cross-database
 * mistarget is observable even when a name-based guard stays satisfied.
 */
export async function dumpDb(
  win: Page,
  connectionId: string,
  dbs: string[],
  colls: string[],
): Promise<Record<string, string[]>> {
  return win.evaluate(
    async ({ connectionId: cid, dbs: d, colls: c }) => {
      const api = (
        window as unknown as {
          atelier: { query: { find: (input: unknown) => Promise<{ documents: unknown[] }> } };
        }
      ).atelier;
      const out: Record<string, string[]> = {};
      for (const db of d) {
        for (const coll of c) {
          try {
            const r = await api.query.find({
              connectionId: cid,
              dbName: db,
              collection: coll,
              filter: '{}',
              limit: 100,
              skip: 0,
            });
            out[`${db}.${coll}`] = (r.documents ?? []).map((x) => String((x as { _id?: unknown })?._id));
          } catch {
            out[`${db}.${coll}`] = ['<unreadable>'];
          }
        }
      }
      return out;
    },
    { connectionId, dbs, colls },
  );
}

/** Namespaces whose document set changed. Empty means nothing was written. */
export function changedNamespaces(
  before: Record<string, string[]>,
  after: Record<string, string[]>,
): string[] {
  return Object.keys(before).filter((ns) => (before[ns] ?? []).join(',') !== (after[ns] ?? []).join(','));
}

// ─── precondition-biased draw ───────────────────────────────────────────
/**
 * Uniform sampling over ALL actions wastes roughly half the budget on steps
 * whose preconditions are not met, and a no-op is indistinguishable from a
 * real action in the trace — which is how a run looks thorough and is not.
 * Draw only from actions whose `can(probe)` currently holds, and count
 * LANDED, never drawn.
 */
export interface Action<P, C> {
  name: string;
  can: (p: P) => boolean;
  run: (c: C) => Promise<void>;
}

export function makeTally() {
  const landedByAction: Record<string, number> = {};
  const blockedByReason: Record<string, number> = {};
  let drawn = 0;
  let landed = 0;
  let blocked = 0;
  return {
    land(name: string) {
      drawn++;
      landed++;
      landedByAction[name] = (landedByAction[name] ?? 0) + 1;
    },
    block(name: string, err: unknown) {
      drawn++;
      blocked++;
      const key = `${name}: ${String(err).slice(0, 60)}`;
      blockedByReason[key] = (blockedByReason[key] ?? 0) + 1;
    },
    summary() {
      return { drawn, landed, blocked, landedByAction, blockedByReason };
    },
  };
}
