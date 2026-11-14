import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Decimal128, Double, Int32, Long, ObjectId } from 'bson';
import { changeList, classifyConflict, diff, resolveConflict } from '../../src/pages/Workspace/documentDiff';
import { ejsonStringify } from '../../src/utils/ejson';

type Doc = Record<string, unknown>;

// Safe names only: the conflict table addresses fields by dotted path, so a
// name holding a "." has no row of its own (the editor refuses to save one).
const key = fc.constantFrom('a', 'b', 'c', 'n');

const leaf = fc.oneof(
  fc.string({ maxLength: 3 }),
  fc.boolean(),
  fc.constant(null),
  fc.integer({ min: -2, max: 2 }).map((n) => new Int32(n)),
  fc.integer({ min: -2, max: 2 }).map((n) => new Double(n)),
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((n) => Long.fromString(n.toString())),
  fc.constantFrom('1.10', '1.1').map((s) => Decimal128.fromString(s)),
  fc.constantFrom('507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012').map((h) => new ObjectId(h)),
  fc.integer({ min: 0, max: 2 }).map((ms) => new Date(ms)),
);

const docOf = (entries: [string, unknown][]): Doc => {
  const out = Object.create(null) as Doc;
  for (const [k, v] of entries) Object.defineProperty(out, k, { value: v, enumerable: true, writable: true, configurable: true });
  return out;
};

const { value } = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    leaf,
    fc.array(tie('value'), { maxLength: 2 }),
    fc.uniqueArray(fc.tuple(key, tie('value')), { selector: ([k]) => k, maxLength: 3 }).map(docOf),
  ),
}));

const ID = new ObjectId('507f1f77bcf86cd799439099');
const topDoc = fc
  .uniqueArray(fc.tuple(key, value), { selector: ([k]) => k, maxLength: 4 })
  .map((entries) => docOf([['_id', ID], ...entries]));
const triple = fc.tuple(topDoc, topDoc, topDoc);

const pathsOf = (d: ReturnType<typeof diff>) => [...Object.keys(d.set), ...d.unset];
const touches = (a: string, b: string) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);

describe('document conflict — properties', () => {
  it('Keep mine on every row: each path of the user\'s diff that differs from the server is still sent', () => {
    fc.assert(
      fc.property(triple, ([original, draft, server]) => {
        const merged = resolveConflict(original, draft, server, new Map());
        const sent = pathsOf(diff(server, merged));
        const rows = classifyConflict(original, draft, server);
        for (const p of pathsOf(diff(original, draft))) {
          const row = rows.find((r) => r.path === p)!;
          const same =
            (row.yours === null && row.theirs === null) ||
            (row.yours !== null && row.theirs !== null && ejsonStringify(row.yours.value) === ejsonStringify(row.theirs.value));
          // A path the server already holds at the user's value needs no write;
          // any other must be covered by a sent path (the same one, or an ancestor/descendant).
          if (!same) expect(sent.some((s) => touches(s, p))).toBe(true);
        }
      }),
    );
  });

  it('Take theirs on every both row: no both-changed path is written', () => {
    fc.assert(
      fc.property(triple, ([original, draft, server]) => {
        const rows = classifyConflict(original, draft, server).filter((r) => r.changedBy === 'both');
        const choices = new Map(rows.map((r) => [r.path, 'theirs' as const]));
        const merged = resolveConflict(original, draft, server, choices);
        const sent = pathsOf(diff(server, merged));
        for (const r of rows) expect(sent.some((s) => touches(s, r.path))).toBe(false);
      }),
    );
  });

  it('the change list has one entry per path of the diff', () => {
    fc.assert(
      fc.property(fc.tuple(topDoc, topDoc), ([original, draft]) => {
        expect(changeList(original, draft).map((e) => e.path).sort((x, y) => x.localeCompare(y))).toEqual(
          pathsOf(diff(original, draft)).sort((x, y) => x.localeCompare(y)),
        );
      }),
    );
  });
});
