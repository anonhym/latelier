import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { EJSON, ObjectId } from 'bson';
import { findValueMatch } from '../../src/utils/referenceDiscovery';

// Field names with no dots and no numeric-only names, so a path is its segments joined.
const fieldName = fc.stringMatching(/^[a-z][a-z0-9]{0,6}$/).filter((k) => k !== '_id');

/** A field path of 1 to 3 names, and the document that holds `leaf` at the end of it. */
function nestAt(path: string[], leaf: unknown): Record<string, unknown> {
  let node: unknown = leaf;
  for (const key of [...path].reverse()) node = { [key]: node };
  return node as Record<string, unknown>;
}

describe('findValueMatch (property)', () => {
  it('finds an ObjectId planted at any field path, however the other fields are filled', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fieldName, { minLength: 1, maxLength: 3 }),
        fc.array(fc.tuple(fieldName, fc.string()), { maxLength: 4 }),
        fc.uint8Array({ minLength: 12, maxLength: 12 }),
        (path, noise, bytes) => {
          const id = new ObjectId(Buffer.from(bytes));
          // The noise fields sit after the planted one, under names that cannot shadow its first segment.
          const doc = { ...nestAt(path, id), ...Object.fromEntries(noise.filter(([k]) => k !== path[0])) };
          const wire = JSON.parse(EJSON.stringify(doc, { relaxed: false })) as unknown;
          expect(findValueMatch([wire], [id.toHexString()])).toBe(path.join('.'));
        },
      ),
    );
  });

  it('never finds an ObjectId that is not in the document', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 12, maxLength: 12 }), fc.uint8Array({ minLength: 12, maxLength: 12 }), (a, b) => {
        fc.pre(Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0);
        const wire = JSON.parse(EJSON.stringify({ ref: new ObjectId(Buffer.from(a)) }, { relaxed: false })) as unknown;
        expect(findValueMatch([wire], [new ObjectId(Buffer.from(b)).toHexString()])).toBeNull();
      }),
    );
  });
});
