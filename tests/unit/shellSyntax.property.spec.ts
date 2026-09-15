import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  refusalMessage,
  repairOnCommit,
  repairToCanonicalEjson,
  type RepairOutcome,
} from '../../src/utils/shellSyntax';

// ─── Shell Syntax generator ───────────────────────────────────────────────
//
// Built from the module's own supported subset (Tier 2 objects/arrays/
// scalars plus the ObjectId/ISODate/NumberLong/NumberInt/NumberDecimal value
// constructors, unquoted and single-quoted keys, trailing commas). Anything
// outside this subset is a deliberate `UnsupportedSyntax` refusal, already
// covered example-by-example in shell-syntax.spec.ts — a property that
// assumes success has nothing to say about that path, so it stays out of the
// generator rather than being filtered out after the fact.
const identChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz");
const identifierKey = fc.array(identChar, { minLength: 1, maxLength: 6 }).map((cs) => cs.join(''));
const quotedKey = identifierKey.map((k) => `'${k}'`);
const keySrc = fc.oneof(identifierKey, quotedKey);

const safeStrChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789 ._-");
const singleQuotedStr = fc.array(safeStrChar, { maxLength: 10 }).map((cs) => `'${cs.join('')}'`);

const hexChar = fc.constantFrom(..."0123456789abcdef");
const hexId = fc.array(hexChar, { minLength: 24, maxLength: 24 }).map((cs) => cs.join(''));

const intDigits = fc.integer({ min: 0, max: 999999 }).map(String);

// `ISODate`/`new Date`'s repair path never parses or validates its string
// argument (sentinelText passes it straight through as `{"$date": <arg>}`),
// so any string is representative here — a fixed one keeps this generator
// small without weakening the property.
const scalarSrc = fc.oneof(
  singleQuotedStr,
  intDigits,
  fc.constantFrom('true', 'false', 'null'),
  hexId.map((h) => `ObjectId("${h}")`),
  fc.constant('ISODate("2026-01-01T00:00:00.000Z")'),
  intDigits.map((n) => `NumberLong(${n})`),
  intDigits.map((n) => `NumberInt(${n})`),
  intDigits.map((n) => `NumberDecimal("${n}")`),
);

const { valueSrc } = fc.letrec((tie) => ({
  valueSrc: fc.oneof(
    { depthSize: 'small' as const },
    scalarSrc,
    fc
      .tuple(fc.array(tie('valueSrc') as fc.Arbitrary<string>, { maxLength: 3 }), fc.boolean())
      .map(([els, trailingComma]) => `[${els.join(', ')}${trailingComma && els.length > 0 ? ',' : ''}]`),
    fc
      .tuple(fc.array(fc.tuple(keySrc, tie('valueSrc') as fc.Arbitrary<string>), { maxLength: 3 }), fc.boolean())
      .map(
        ([props, trailingComma]) =>
          `{${props.map(([k, v]) => `${k}: ${v}`).join(', ')}${trailingComma && props.length > 0 ? ',' : ''}}`,
      ),
  ),
}));

// Non-empty top level and a mix of unquoted/single-quoted keys guarantees
// this is never already-valid JSON (neither key form is legal JSON syntax),
// so every generated string takes the real repair path, not the pass-through.
const objectSrc = fc
  .tuple(fc.array(fc.tuple(keySrc, valueSrc), { minLength: 1, maxLength: 3 }), fc.boolean())
  .map(([props, trailingComma]) => `{${props.map(([k, v]) => `${k}: ${v}`).join(', ')}${trailingComma ? ',' : ''}}`);

describe('repairToCanonicalEjson property: the supported subset always repairs', () => {
  it('never fails on shell-syntax text built from the module\'s own supported constructs', () => {
    fc.assert(
      fc.property(objectSrc, (shell) => {
        expect(repairToCanonicalEjson(shell).kind).toBe('repaired');
      }),
      { numRuns: 40 },
    );
  });
});

describe('repairToCanonicalEjson property: a repair never produces invalid output', () => {
  it('the repaired text always parses as JSON — "valid" per the module\'s own first check', () => {
    fc.assert(
      fc.property(objectSrc, (shell) => {
        const outcome = repairToCanonicalEjson(shell);
        if (outcome.kind !== 'repaired') return; // covered by the always-repairs property above
        expect(() => JSON.parse(outcome.text)).not.toThrow();
      }),
      { numRuns: 40 },
    );
  });

  it('text that already parses as JSON is always left `unchanged`, never touched', () => {
    // fc.jsonValue()'s output is exactly the module's own definition of
    // "already valid" (the first thing repairToCanonicalEjson checks), so
    // this is the real, not assumed, notion of valid input for this module.
    fc.assert(
      fc.property(fc.jsonValue(), (v) => {
        expect(repairToCanonicalEjson(JSON.stringify(v))).toEqual({ kind: 'unchanged' });
      }),
      { numRuns: 30 },
    );
  });
});

describe('repairToCanonicalEjson property: idempotence', () => {
  it('repairing an already-repaired text is a no-op the second time', () => {
    fc.assert(
      fc.property(objectSrc, (shell) => {
        const first = repairToCanonicalEjson(shell);
        if (first.kind !== 'repaired') return;
        expect(repairToCanonicalEjson(first.text)).toEqual({ kind: 'unchanged' });
      }),
      { numRuns: 40 },
    );
  });
});

describe('repairOnCommit property: idempotence', () => {
  it('applying repairOnCommit to its own returned text is a no-op the second time', () => {
    fc.assert(
      fc.property(objectSrc, (shell) => {
        const first = repairOnCommit(shell, () => {});
        const second = repairOnCommit(first.text, () => {});
        expect(second.text).toBe(first.text);
        expect(second.outcome).toEqual({ kind: 'unchanged' });
      }),
      { numRuns: 40 },
    );
  });
});

describe('repairOnCommit property: the commit contract', () => {
  it('calls commit exactly once with outcome.text when repaired, never otherwise, and text always tracks the outcome', () => {
    fc.assert(
      fc.property(fc.oneof(objectSrc, fc.string({ maxLength: 30 })), (text) => {
        const commits: string[] = [];
        const result = repairOnCommit(text, (t) => commits.push(t));
        if (result.outcome.kind === 'repaired') {
          expect(commits).toEqual([result.outcome.text]);
          expect(result.text).toBe(result.outcome.text);
        } else {
          expect(commits).toEqual([]);
          expect(result.text).toBe(text);
        }
      }),
      { numRuns: 40 },
    );
  });
});

// ─── refusalMessage — a pure function of (text, outcome), fuzzed directly ──
//
// No need to route through real shell-syntax generation here: refusalMessage
// takes any RepairOutcome value, so its contract can be exercised with
// synthetic outcomes, including ones a real repair would never produce (a
// negative or out-of-range index) — the guard clamps them (`Math.min`), so
// this also confirms it never throws for those.
const failedOutcomeArb: fc.Arbitrary<Extract<RepairOutcome, { kind: 'failed' }>> = fc
  .tuple(fc.string({ maxLength: 20 }), fc.option(fc.integer({ min: -50, max: 500 }), { nil: undefined }))
  .map(([reason, index]) => (index === undefined ? { kind: 'failed', reason } : { kind: 'failed', reason, index }));

const outcomeArb: fc.Arbitrary<RepairOutcome> = fc.oneof(
  fc.constant<RepairOutcome>({ kind: 'unchanged' }),
  fc.string({ maxLength: 10 }).map((text): RepairOutcome => ({ kind: 'repaired', text })),
  failedOutcomeArb,
);

describe('refusalMessage property', () => {
  it('never throws, and is null exactly when the outcome is not a failure or the text is blank', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), outcomeArb, (text, outcome) => {
        const msg = refusalMessage(text, outcome);
        const shouldBeNull = outcome.kind !== 'failed' || text.trim() === '';
        expect(msg === null).toBe(shouldBeNull);
      }),
      { numRuns: 40 },
    );
  });

  it('carries the reason verbatim, prefixed with a 1-based line/column only when the outcome has an index', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim() !== ''), failedOutcomeArb, (text, outcome) => {
        const msg = refusalMessage(text, outcome);
        if (outcome.index === undefined) {
          expect(msg).toBe(outcome.reason);
        } else {
          expect(msg).toMatch(/^Line \d+, column \d+: /);
          expect(msg).toContain(outcome.reason);
        }
      }),
      { numRuns: 40 },
    );
  });
});
