import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ObjectId } from 'bson';
import { distinctiveValues } from '../../src/utils/distinctiveValues';

// An ObjectId is the same value however it is written, and each spelling the
// app copies or a person pastes has to yield that one hex string. Inputs are
// real `bson` ObjectIds, from a 12-byte buffer, never hand-built hex.
const objectId = fc.uint8Array({ minLength: 12, maxLength: 12 }).map((bytes) => new ObjectId(bytes));

describe('distinctiveValues property: ObjectId spellings', () => {
  it('bare, $oid and ObjectId("…") all extract the same hex', () => {
    fc.assert(
      fc.property(objectId, (id) => {
        const hex = id.toHexString();
        const bare = distinctiveValues(hex);
        expect(bare).toEqual([hex]);
        expect(distinctiveValues(JSON.stringify({ $oid: hex }))).toEqual(bare);
        expect(distinctiveValues(`ObjectId("${hex}")`)).toEqual(bare);
        expect(distinctiveValues(`ObjectId('${hex}')`)).toEqual(bare);
      }),
    );
  });

  it('the upper-case spelling extracts the same hex', () => {
    fc.assert(
      fc.property(objectId, (id) => {
        expect(distinctiveValues(id.toHexString().toUpperCase())).toEqual([id.toHexString()]);
      }),
    );
  });

  it('a document holding the id finds it among its other values, whatever surrounds it', () => {
    fc.assert(
      fc.property(objectId, fc.boolean(), fc.integer({ min: 0, max: 99_999 }), (id, flag, small) => {
        const text = JSON.stringify({ _id: { $oid: id.toHexString() }, flag, small, nothing: null });
        expect(distinctiveValues(text)).toEqual([id.toHexString()]);
      }),
    );
  });
});
