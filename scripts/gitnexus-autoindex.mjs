#!/usr/bin/env node
/**
 * gitnexus-autoindex.mjs
 *
 * Claude Code SessionStart hook: reindexes the GitNexus knowledge graph when
 * it has fallen behind HEAD, instead of only printing "index is stale".
 *
 * Staleness is `git rev-parse HEAD` !== `.gitnexus/meta.json`.lastCommit —
 * the same test the global gitnexus hook uses to decide whether to nag.
 *
 * Runs with `--index-only`, which refreshes the graph but skips all file
 * injection. That is deliberate: cluster assignment is NOT deterministic —
 * re-running analysis on an unchanged commit moves symbols between areas
 * (Mongo 197<->203, Aggregation 90<->96), so a doc-writing run would dirty
 * CLAUDE.md, AGENTS.md and several `.claude/skills/generated/` files at
 * every session start. An automatic hook must never leave the tree dirty.
 *
 * Consequence: the generated docs go stale even while the graph is fresh.
 * Refresh them deliberately with `npx gitnexus analyze --pdg --skills`, and
 * note the `--skills` flag is load-bearing — a bare `analyze` regenerates
 * the block between the `gitnexus:start`/`gitnexus:end` markers from that
 * run's output alone, silently dropping every `.claude/skills/generated/`
 * row from both files while leaving the skill files on disk.
 *
 * Doesn't read stdin (SessionStart payload is empty). Exits 0 in all cases
 * — this is advisory, not blocking. Skips silently when the repo has no
 * index yet, so a fresh clone doesn't pay for a full first analysis it
 * never asked for.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const metaFile = join(repoRoot, '.gitnexus', 'meta.json');

// No index yet — nothing to refresh. `analyze` would build one from scratch,
// which is not what "keep the index fresh" should cost on a fresh clone.
//
// Cloud sessions are the exception: every one of them IS a fresh clone
// (`.gitnexus` is gitignored), so "skip" would mean CLAUDE.md's mandatory
// impact analysis never has a graph to run against. Build it there, detached,
// so the session starts immediately and the graph lands a few minutes in.
if (!existsSync(metaFile)) {
  if (process.env.CLAUDE_CODE_REMOTE === 'true') {
    // --index-only for the same reason the stale path uses it: doc injection
    // is non-deterministic and would leave the working tree dirty mid-PR.
    spawn('npx', ['gitnexus', 'analyze', '--pdg', '--index-only'], {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
    }).unref();
    process.stderr.write(`\nGitNexus: no index — building it in the background.\n\n`);
  }
  process.exit(0);
}

function headCommit() {
  const res = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    timeout: 3000,
    encoding: 'utf8',
  });
  return res.status === 0 ? (res.stdout || '').trim() : '';
}

function lastIndexedCommit() {
  try {
    return JSON.parse(readFileSync(metaFile, 'utf8')).lastCommit || '';
  } catch {
    return ''; // unreadable meta — treat as stale
  }
}

const head = headCommit();
if (!head) process.exit(0); // detached, not a repo, or git unavailable
if (head === lastIndexedCommit()) process.exit(0); // already fresh

process.stderr.write(`\nGitNexus index is stale — refreshing the graph...\n`);

const res = spawnSync('npx', ['gitnexus', 'analyze', '--pdg', '--index-only'], {
  cwd: repoRoot,
  timeout: 240_000,
  encoding: 'utf8',
});

if (res.status === 0) {
  process.stderr.write(`GitNexus index refreshed to ${head.slice(0, 7)}.\n\n`);
} else {
  const detail = String(res.stderr || res.error?.message || '').trim().split('\n').pop() ?? '';
  process.stderr.write(
    `GitNexus reindex failed (${detail || `exit ${res.status}`}). ` +
      `Run it by hand: npx gitnexus analyze --pdg --index-only\n\n`,
  );
}

process.exit(0);
