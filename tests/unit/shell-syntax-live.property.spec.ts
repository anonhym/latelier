import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ObjectId, Long, Decimal128, Int32, Double, BSONRegExp } from 'bson';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import { toMongoshLiteral } from '../../src/utils/copyFormat';
import { liveValidity } from '../../src/utils/shellSyntax';
import { runProblem } from '../../src/pages/Workspace/optionPills';

// The types Shell Syntax has a spelling for, built with real bson
// constructors: a boxed Int32/Double and a raw JS number compare unequal.
const scalar = fc.oneof(
  fc.string(),
  fc.boolean(),
  fc.constant(null),
  fc.date({ noInvalidDate: true }),
  fc.constant(null).map(() => new ObjectId()),
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }).map((n) => Long.fromString(n.toString())),
  fc.float({ noNaN: true }).map((n) => Decimal128.fromString(n.toString())),
  fc.integer({ min: -(2 ** 31), max: 2 ** 31 - 1 }).map((n) => new Int32(n)),
  // Shell Syntax has no Double constructor, so only the doubles a plain
  // number already spells exactly.
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((n) => !Number.isInteger(n))
    .map((n) => new Double(n)),
  // Characters that need no escaping in a `/…/` literal.
  fc
    .tuple(
      fc.array(fc.constantFrom(...'abcxyz019 ._-^$'), { minLength: 1, maxLength: 12 }).map((c) => c.join('')),
      fc.subarray([...'imsu']).map((f) => f.join('')),
    )
    .map(([pattern, flags]) => new BSONRegExp(pattern, flags)),
);

// A field name starting with `$` is an EJSON sentinel or an operator, not a field.
const key = fc.string({ minLength: 1, maxLength: 10 }).filter((k) => !k.startsWith('$'));
const { tree } = fc.letrec((t) => ({
  tree: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    scalar,
    fc.array(t('tree'), { maxLength: 4 }),
    fc.dictionary(key, t('tree'), { maxKeys: 4 }),
  ),
}));
const filterDoc = fc.dictionary(key, tree, { maxKeys: 6 });

describe('a filter typed the way mongosh prints it', () => {
  it('is live-valid, repairs to the document\'s Canonical EJSON, and leaves Run open', () => {
    fc.assert(
      fc.property(filterDoc, (doc) => {
        const typed = toMongoshLiteral(doc);
        const live = liveValidity(typed);
        expect(live.runnable).toBe(true);
        expect(ejsonStringify(ejsonParse(live.text))).toBe(ejsonStringify(doc));
        expect(runProblem({ queryRaw: typed, builder: { projection: [], sort: '', limit: '' } })).toBeNull();
      }),
    );
  });

  it('is marked repaired exactly when the text is not the document\'s EJSON already', () => {
    fc.assert(
      fc.property(filterDoc, (doc) => {
        const typed = toMongoshLiteral(doc);
        const live = liveValidity(typed);
        expect(live.repaired).toBe(live.text !== typed);
      }),
    );
  });
});
