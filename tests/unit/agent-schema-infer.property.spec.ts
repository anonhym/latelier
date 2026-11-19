import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Decimal128, Double, Int32, Long, ObjectId } from 'bson';
import { inferSchema } from '../../electron/agent/schemaInfer';

// Leaves carry a marker no field name or type name can contain, so a leak is a substring match.
const MARK = 'VAL~';
const leaf = fc.oneof(
  fc.string({ minLength: 1, maxLength: 12 }).map((s) => `${MARK}${s}`),
  fc.integer({ min: 100_000, max: 999_999 }).map((n) => new Int32(n)),
  fc.integer({ min: 100_000, max: 999_999 }).map((n) => Long.fromNumber(n)),
  fc.integer({ min: 100_000, max: 999_999 }).map((n) => new Double(n + 0.5)),
  fc.integer({ min: 100_000, max: 999_999 }).map((n) => Decimal128.fromString(String(n))),
  fc.date({ min: new Date('2001-01-01'), max: new Date('2030-01-01'), noInvalidDate: true }),
  fc.constant(null).map(() => new ObjectId()),
  fc.boolean(),
  fc.constant(null),
);

// Field names are letters and digits only, so neither a key nor a type name can look like a value.
const key = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/);

const { value: anyValue } = fc.letrec<{ value: unknown }>((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', maxDepth: 3 },
    leaf,
    fc.array(tie('value'), { maxLength: 3 }),
    fc.dictionary(key, tie('value'), { maxKeys: 3 }),
  ),
}));

const doc = fc.dictionary(key, anyValue, { maxKeys: 5 });

function leavesOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string' && value.startsWith(MARK)) out.push(value);
  else if (Array.isArray(value)) for (const v of value) leavesOf(v, out);
  else if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    for (const v of Object.values(value)) leavesOf(v, out);
  }
  return out;
}

describe('schema inference properties', () => {
  it('never emits a string value from any document', () => {
    fc.assert(
      fc.property(fc.array(doc, { maxLength: 6 }), (docs) => {
        const out = JSON.stringify(inferSchema(docs));
        for (const d of docs) for (const v of leavesOf(d)) expect(out).not.toContain(v);
      }),
      { numRuns: 300 },
    );
  });

  it('reports counts and a frequency that agree with the sample size', () => {
    fc.assert(
      fc.property(fc.array(doc, { minLength: 1, maxLength: 6 }), (docs) => {
        const r = inferSchema(docs);
        for (const f of r.fields) {
          expect(f.docs).toBeGreaterThanOrEqual(1);
          expect(f.docs).toBeLessThanOrEqual(r.sampled);
          expect(f.frequency).toBeGreaterThan(0);
          expect(f.frequency).toBeLessThanOrEqual(1);
          for (const n of Object.values(f.types)) expect(n).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 300 },
    );
  });

  it('gives the same answer whatever order the documents arrive in', () => {
    fc.assert(
      fc.property(fc.array(doc, { maxLength: 6 }), (docs) => {
        expect(inferSchema([...docs].reverse())).toEqual(inferSchema(docs));
      }),
      { numRuns: 200 },
    );
  });

  it('lists every path in sorted order, each once', () => {
    fc.assert(
      fc.property(fc.array(doc, { maxLength: 6 }), (docs) => {
        const paths = inferSchema(docs).fields.map((f) => f.path);
        expect(paths).toEqual([...paths].sort((a, b) => a.localeCompare(b)));
        expect(new Set(paths).size).toBe(paths.length);
      }),
      { numRuns: 200 },
    );
  });
});
