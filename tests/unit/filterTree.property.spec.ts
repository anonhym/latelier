import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseFilter,
  printFilter,
  nodeAt,
  updateAt,
  insertAt,
  removeAt,
  moveAt,
  toRawNode,
  tryParseRaw,
  buildScalarWire,
  type GroupNode,
  type CondNode,
  type RawNode,
  type FilterNode,
} from '../../src/pages/Workspace/filterTree';
import type { ValType } from '@shared/types';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Non-blank, never `$`-prefixed — a `$`-leading key is a clause-level
// operator to this module, not a field name (MongoDB field names can't lead
// with `$`), so it would parse as a raw node rather than round-trip as a
// cond. Keeping the leaf generator inside the space this module treats as an
// ordinary field name is what makes the "always prints ok" and round-trip
// properties below hold unconditionally.
const fieldNameArb = fc.string({ minLength: 1, maxLength: 6 }).filter((s) => s.trim() !== '' && !s.startsWith('$'));

// The six comparison ops: always `isCompilableOp`, and every value in the
// ranges below passes `condValueProblem` regardless of which one is picked —
// keeps every generated cond unconditionally printable.
const SIMPLE_OPS = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'] as const;

const safeCondArb: fc.Arbitrary<CondNode> = fc.oneof(
  fc.record({
    kind: fc.constant('cond' as const),
    field: fieldNameArb,
    op: fc.constantFrom(...SIMPLE_OPS),
    valType: fc.constant<ValType>('string'),
    value: fc.string({ maxLength: 8 }),
  }),
  fc.record({
    kind: fc.constant('cond' as const),
    field: fieldNameArb,
    op: fc.constantFrom(...SIMPLE_OPS),
    valType: fc.constant<ValType>('number'),
    // Bounded well inside Number.isSafeInteger range — large-integer
    // precision loss is a separate, deliberately documented ceiling (§3a in
    // filterTree.ts) this file isn't exercising.
    value: fc.integer({ min: -1000, max: 1000 }).map(String),
  }),
);

// A raw node whose text is always valid, non-blank JSON — never pending,
// never blocked.
const safeRawArb: fc.Arbitrary<RawNode> = fc
  .record({ field: fieldNameArb, value: fc.oneof(fc.string({ maxLength: 8 }), fc.integer({ min: -1000, max: 1000 })) })
  .map(({ field, value }): RawNode => ({ kind: 'raw', json: JSON.stringify({ [field]: value }) }));

const safeLeafArb: fc.Arbitrary<FilterNode> = fc.oneof(safeCondArb, safeRawArb);

// Recursive tree, depth capped tightly (fast-check's `maxDepth` on the
// top-level `oneof` biases toward leaves as depth grows) — both for
// Stryker's per-mutant rerun cost and because a handful of levels already
// exercises every branch in `printNode`/`parseClauseToNodes`.
const { group: safeGroup } = fc.letrec<{ node: FilterNode; group: GroupNode }>((tie) => ({
  node: fc.oneof({ maxDepth: 2 }, safeLeafArb, tie('group')),
  group: fc.record({
    kind: fc.constant('group' as const),
    logic: fc.constantFrom<GroupNode['logic']>('$and', '$or', '$nor'),
    children: fc.array(tie('node'), { maxLength: 3 }),
  }),
}));

// A second, hostile leaf generator — arbitrary ops and arbitrary (possibly
// invalid-JSON) raw text — used only for the "never throws" property. Kept
// separate from `safeGroup` so the "always prints ok" and round-trip
// properties above stay uncontaminated by leaves that are supposed to block.
const hostileLeafArb: fc.Arbitrary<FilterNode> = fc.oneof(
  safeLeafArb,
  fc.record({
    kind: fc.constant('cond' as const),
    field: fieldNameArb,
    op: fc.string({ maxLength: 6 }),
    valType: fc.constantFrom<ValType>('string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array'),
    value: fc.string({ maxLength: 10 }),
  }),
  fc.string({ maxLength: 20 }).map((json): RawNode => ({ kind: 'raw', json })),
);
const { group: hostileGroup } = fc.letrec<{ node: FilterNode; group: GroupNode }>((tie) => ({
  node: fc.oneof({ maxDepth: 2 }, hostileLeafArb, tie('group')),
  group: fc.record({
    kind: fc.constant('group' as const),
    logic: fc.constantFrom<GroupNode['logic']>('$and', '$or', '$nor'),
    children: fc.array(tie('node'), { maxLength: 3 }),
  }),
}));

function countLeaves(n: FilterNode): number {
  return n.kind === 'group' ? n.children.reduce((s, c) => s + countLeaves(c), 0) : 1;
}

// ─── Totality ────────────────────────────────────────────────────────────────

describe('parseFilter: total over any string', () => {
  it('never throws, including on garbage input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), (s) => {
        expect(() => parseFilter(s)).not.toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

describe('printFilter: total over any tree', () => {
  it('never throws, including on hostile ops and unparseable raw text', () => {
    fc.assert(
      fc.property(hostileGroup, (root) => {
        expect(() => printFilter(root)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it('a tree built entirely from printable leaves always prints ok', () => {
    fc.assert(
      fc.property(safeGroup, (root) => {
        expect(printFilter(root).ok).toBe(true);
      }),
      { numRuns: 40 },
    );
  });

  // The invariant "an empty/blank filter never widens to match everything" — one
  // blocked leaf anywhere in the tree must fail the whole print, never
  // silently collapse to the "no filter" `{}`.
  it('a tree containing one invalid cond never widens to {} — it fails to print', () => {
    fc.assert(
      fc.property(safeGroup, fieldNameArb, (root, field) => {
        const badCond: CondNode = { kind: 'cond', field, op: '$eq', valType: 'long', value: 'not-an-integer' };
        const withBad: GroupNode = { ...root, children: [...root.children, badCond] };
        const result = printFilter(withBad);
        expect(result.ok).toBe(false);
      }),
      { numRuns: 30 },
    );
  });
});

// ─── Print/parse fixpoint ────────────────────────────────────────────────────

describe('print -> parse -> print is a fixpoint once normalized', () => {
  // NOT a fixpoint from the very first print: a `RawNode` prints
  // byte-for-byte, but a representable raw clause (e.g. `{"!":0}`, an
  // implicit-$eq scalar) re-parses into a *cond*, which prints back in the
  // canonical `{field:{$op:value}}` operator-map form — `{"!":0}` ->
  // `{"!":{"$eq":0}}`. Confirmed empirically: `safeRawArb` generates exactly
  // this shape (a plain scalar under a non-`$` field), so the naive
  // print->parse->print claim fails on the very first counterexample.
  //
  // The invariant that does hold: printing is a normal form. One parse/print
  // cycle settles any raw->cond upgrade; every cycle after that is a true
  // no-op. Verified by normalizing once before asserting the fixpoint.
  it('reprinting an already-normalized tree yields the identical JSON', () => {
    fc.assert(
      fc.property(safeGroup, (root) => {
        const first = printFilter(root);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const normalized = parseFilter(first.json);
        expect(normalized.ok).toBe(true);
        if (!normalized.ok) return;
        const normalizedPrint = printFilter(normalized.root);
        expect(normalizedPrint.ok).toBe(true);
        if (!normalizedPrint.ok) return;

        const reparsed = parseFilter(normalizedPrint.json);
        expect(reparsed.ok).toBe(true);
        if (!reparsed.ok) return;
        const second = printFilter(reparsed.root);
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.json).toBe(normalizedPrint.json);
      }),
      { numRuns: 40 },
    );
  });
});

// ─── Edit API ────────────────────────────────────────────────────────────────

describe('edit API: structural invariants', () => {
  it('insertAt at the root increases the leaf count by exactly one', () => {
    fc.assert(
      fc.property(safeGroup, safeLeafArb, (root, leaf) => {
        const before = countLeaves(root);
        const after = countLeaves(insertAt(root, [], leaf));
        expect(after).toBe(before + 1);
      }),
      { numRuns: 30 },
    );
  });

  it('removeAt removes exactly the leaf count of the removed child', () => {
    fc.assert(
      fc.property(safeGroup, fc.nat(), (root, n) => {
        if (root.children.length === 0) return;
        const i = n % root.children.length;
        const before = countLeaves(root);
        const removed = countLeaves(root.children[i]);
        const after = countLeaves(removeAt(root, [i]));
        expect(after).toBe(before - removed);
      }),
      { numRuns: 30 },
    );
  });

  it('moveAt never changes the total leaf count', () => {
    fc.assert(
      fc.property(safeGroup, fc.nat(), fc.integer({ min: -2, max: 2 }), (root, n, delta) => {
        if (root.children.length === 0) return;
        const i = n % root.children.length;
        const before = countLeaves(root);
        const after = countLeaves(moveAt(root, [i], delta));
        expect(after).toBe(before);
      }),
      { numRuns: 30 },
    );
  });

  it('updateAt then nodeAt at the same path returns the replacement node', () => {
    fc.assert(
      fc.property(safeGroup, fc.nat(), safeLeafArb, (root, n, replacement) => {
        if (root.children.length === 0) return;
        const i = n % root.children.length;
        const updated = updateAt(root, [i], replacement);
        expect(nodeAt(updated, [i])).toEqual(replacement);
      }),
      { numRuns: 30 },
    );
  });
});

// ─── toRawNode / tryParseRaw ─────────────────────────────────────────────────

describe('toRawNode -> tryParseRaw round-trip', () => {
  it('recovers an equivalent cond for any printable cond', () => {
    fc.assert(
      fc.property(safeCondArb, (c) => {
        const raw = toRawNode(c);
        expect(tryParseRaw(raw)).toEqual(c);
      }),
      { numRuns: 30 },
    );
  });
});

// ─── buildScalarWire ─────────────────────────────────────────────────────────

const ALL_VAL_TYPES: ValType[] = [
  'string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array',
];

describe('buildScalarWire: total over any (valType, value)', () => {
  it('never throws, including malformed numeric/array text', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ALL_VAL_TYPES), fc.string({ maxLength: 15 }), (valType, value) => {
        expect(() => buildScalarWire(valType, value)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });
});
