import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { ValType } from '@shared/types';
import { convertValue } from '../../src/pages/Workspace/kindChange';

const KINDS: ValType[] = ['string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array'];
const kind = fc.constantFrom<ValType>(...KINDS);

// Text that is more likely than random noise to read as some kind.
const text = fc.oneof(
  fc.string(),
  fc.integer().map(String),
  fc.double({ noNaN: true }).map(String),
  fc.constantFrom('true', 'false', '2026-04-01', '2026-04-01T10:00:00Z', '507f1f77bcf86cd799439011', ''),
);

describe('convertValue properties', () => {
  it('never throws, and converted text is the text itself', () => {
    fc.assert(
      fc.property(text, kind, kind, (t, from, to) => {
        const r = convertValue(t, from, to);
        if (r.kind === 'converted') expect(r.text).toBe(t);
      }),
    );
  });

  it('a value converted to a kind and back is unchanged when both read it', () => {
    fc.assert(
      fc.property(text, kind, kind, (t, a, b) => {
        const there = convertValue(t, a, b);
        fc.pre(there.kind === 'converted');
        const back = convertValue(t, b, a);
        fc.pre(back.kind === 'converted');
        expect(back.text).toBe(t);
      }),
    );
  });

  it('an empty box is always kept', () => {
    fc.assert(
      fc.property(kind, kind, (a, b) => {
        expect(convertValue('', a, b)).toEqual({ kind: 'keep' });
      }),
    );
  });

  it('a string reads any text', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), kind, (t, from) => {
        fc.pre(['string', 'number', 'long', 'decimal', 'boolean', 'date', 'objectid'].includes(from));
        expect(convertValue(t, from, 'string')).toEqual({ kind: 'converted', text: t });
      }),
    );
  });
});
