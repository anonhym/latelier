import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ObjectId } from 'bson';
import { formatLocalDateTime, objectIdTimestamp } from '../../src/pages/Workspace/objectIdDate';

describe('objectIdDate property', () => {
  const seconds = fc.integer({ min: 0, max: 0xffffffff });

  it('an ObjectId made from a time reads back as that time', () => {
    fc.assert(
      fc.property(seconds, (sec) => {
        const hex = ObjectId.createFromTime(sec).toHexString();
        expect(objectIdTimestamp(hex)?.getTime()).toBe(sec * 1000);
      }),
    );
  });

  it('never throws on an arbitrary string, and is non-null only for 24 hex digits', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const result = objectIdTimestamp(text);
        expect(result !== null).toBe(/^[0-9a-f]{24}$/i.test(text));
      }),
    );
  });

  it('any 24-hex string reads as a valid date', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0-9a-fA-F]{24}$/), (hex) => {
        expect(Number.isNaN(objectIdTimestamp(hex)?.getTime())).toBe(false);
      }),
    );
  });

  it('formatted UTC output has a fixed shape for every ObjectId time', () => {
    fc.assert(
      fc.property(seconds, (sec) => {
        const text = formatLocalDateTime(new Date(sec * 1000), 'UTC');
        expect(text).toMatch(/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d:[0-5]\d UTC$/);
      }),
    );
  });
});
