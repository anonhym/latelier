import { describe, it, expect } from 'vitest';
import { toDisplayValue, valueToClipboardText, isRecord, docKey } from '../../src/utils/displayValue';

describe('toDisplayValue', () => {
  describe('EJSON shapes', () => {
    it('ObjectId shape → objectid type', () => {
      const v = { $oid: '507f1f77bcf86cd799439011' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('objectid');
      expect(result.display).toBe('507f1f77bcf86cd799439011');
    });

    it('Date shape with ISO string → date type', () => {
      const v = { $date: '2024-01-15T12:00:00.000Z' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('date');
      expect(result.display).toBe('2024-01-15T12:00:00.000Z');
    });

    it('Date shape with number → date type', () => {
      const v = { $date: 0 };
      const result = toDisplayValue(v);
      expect(result.type).toBe('date');
      expect(result.display).toContain('1970');
    });

    it('NumberInt shape → number type', () => {
      const v = { $numberInt: '5' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('number');
      expect(result.display).toBe('5');
    });

    it('NumberDouble shape → number type', () => {
      const v = { $numberDouble: '3.14' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('number');
      expect(result.display).toBe('3.14');
    });

    it('NumberDouble shape with special string → number type', () => {
      const v = { $numberDouble: 'Infinity' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('number');
      expect(result.display).toBe('Infinity');
    });

    it('NumberLong shape → long type', () => {
      const v = { $numberLong: '9007199254740993' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('long');
      expect(result.display).toBe('9007199254740993');
    });

    it('NumberDecimal shape → decimal type', () => {
      const v = { $numberDecimal: '3.14159265358979323846' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('decimal');
      expect(result.display).toBe('3.14159265358979323846');
    });

    it('Regex shape → regex type', () => {
      const v = { $regex: '^abc', $options: 'i' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('regex');
      expect(result.display).toBe('/^abc/i');
    });

    it('Regex shape without options', () => {
      const v = { $regex: 'test' };
      const result = toDisplayValue(v);
      expect(result.type).toBe('regex');
      expect(result.display).toBe('/test/');
    });

    it('Binary shape → binary type, display truncated to first 16 base64 chars', () => {
      const v = { $binary: { base64: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', subType: '00' } };
      const result = toDisplayValue(v);
      expect(result.type).toBe('binary');
      expect(result.display).toBe('Binary(ABCDEFGHIJKLMNOP...)');
    });

    it('Binary shape with non-string base64 → display falls back to "?"', () => {
      const v = { $binary: { base64: 42, subType: '00' } };
      const result = toDisplayValue(v);
      expect(result.type).toBe('binary');
      expect(result.display).toBe('Binary(?...)');
    });
  });

  describe('EJSON sentinel guards — exact key AND value shape required', () => {
    it('$oid with a non-string value is not an objectid — falls to generic object', () => {
      const result = toDisplayValue({ $oid: 12345 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$oid with a string value but extra keys is not an objectid', () => {
      const result = toDisplayValue({ $oid: '507f1f77bcf86cd799439011', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$date with extra keys is not a date', () => {
      const result = toDisplayValue({ $date: '2024-01-15T12:00:00.000Z', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$date value shaped as { $numberLong } decodes via Number(...) then Date', () => {
      const result = toDisplayValue({ $date: { $numberLong: '0' } });
      expect(result.type).toBe('date');
      expect(result.display).toBe(new Date(0).toISOString());
    });

    it('$date value of an unrecognized shape falls back to String(d)', () => {
      const result = toDisplayValue({ $date: true });
      expect(result.type).toBe('date');
      expect(result.display).toBe('true');
    });

    it('$date value that is a record but lacks a string $numberLong falls back to String(d)', () => {
      // Distinguishes `isRecord(d) && typeof d.$numberLong === 'string'` from a
      // weaker `isRecord(d)` alone — without this, a record missing $numberLong
      // would wrongly attempt `new Date(Number(undefined))`, an Invalid Date
      // whose .toISOString() throws, instead of falling to the String(d) branch.
      const result = toDisplayValue({ $date: { foo: 'bar' } });
      expect(result.type).toBe('date');
      expect(result.display).toBe(String({ foo: 'bar' }));
    });

    it('$numberInt with a non-string value is not a number sentinel', () => {
      const result = toDisplayValue({ $numberInt: 5 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$numberInt with a string value but extra keys is not a number sentinel', () => {
      const result = toDisplayValue({ $numberInt: '5', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$numberDouble with a non-string value is not a number sentinel', () => {
      const result = toDisplayValue({ $numberDouble: 3.14 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$numberDouble with a string value but extra keys is not a number sentinel', () => {
      const result = toDisplayValue({ $numberDouble: '3.14', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$numberLong with a non-string value is not a long sentinel', () => {
      const result = toDisplayValue({ $numberLong: 42 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$numberLong with a string value but extra keys is not a long sentinel', () => {
      const result = toDisplayValue({ $numberLong: '9007199254740993', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$numberDecimal with a non-string value is not a decimal sentinel', () => {
      const result = toDisplayValue({ $numberDecimal: 3.14 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$numberDecimal with a string value but extra keys is not a decimal sentinel', () => {
      const result = toDisplayValue({ $numberDecimal: '3.14159265358979323846', extra: 1 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('$regex with a non-string value is not a regex sentinel', () => {
      const result = toDisplayValue({ $regex: 123 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });

    it('$binary present but not shaped as a record is not a binary sentinel', () => {
      const result = toDisplayValue({ $binary: 'not-a-record' });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{1}');
    });
  });

  describe('primitives', () => {
    it('string → string type', () => {
      const result = toDisplayValue('hello');
      expect(result.type).toBe('string');
      expect(result.display).toBe('hello');
    });

    it('number → number type', () => {
      const result = toDisplayValue(42);
      expect(result.type).toBe('number');
      expect(result.display).toBe('42');
    });

    it('float number → number type', () => {
      const result = toDisplayValue(3.14);
      expect(result.type).toBe('number');
      expect(result.display).toBe('3.14');
    });

    it('boolean true → boolean type', () => {
      const result = toDisplayValue(true);
      expect(result.type).toBe('boolean');
      expect(result.display).toBe('true');
    });

    it('boolean false → boolean type', () => {
      const result = toDisplayValue(false);
      expect(result.type).toBe('boolean');
      expect(result.display).toBe('false');
    });

    it('null → null type', () => {
      const result = toDisplayValue(null);
      expect(result.type).toBe('null');
      expect(result.display).toBe('null');
    });

    it('undefined → undefined type', () => {
      const result = toDisplayValue(undefined);
      expect(result.type).toBe('undefined');
      expect(result.display).toBe('undefined');
    });
  });

  describe('complex types', () => {
    it('array → array type with length', () => {
      const result = toDisplayValue([1, 2, 3]);
      expect(result.type).toBe('array');
      expect(result.display).toBe('[3]');
    });

    it('empty array → array type', () => {
      const result = toDisplayValue([]);
      expect(result.type).toBe('array');
      expect(result.display).toBe('[0]');
    });

    it('plain object → object type with key count', () => {
      const result = toDisplayValue({ a: 1, b: 2 });
      expect(result.type).toBe('object');
      expect(result.display).toBe('{2}');
    });

    it('empty object → object type', () => {
      const result = toDisplayValue({});
      expect(result.type).toBe('object');
      expect(result.display).toBe('{0}');
    });

    it('a non-string, non-record, non-array primitive falls back to String(v)', () => {
      // symbol/function/bigint are typeof !== 'object' and !== 'string', so they
      // skip every branch above and land on the final `return { type: 'string',
      // display: String(v), raw: v }` fallback.
      const fn = () => {};
      const result = toDisplayValue(fn);
      expect(result.type).toBe('string');
      expect(result.display).toBe(String(fn));
      expect(result.raw).toBe(fn);
    });
  });

  describe('raw field', () => {
    it('raw contains original value', () => {
      const arr = [1, 2, 3];
      const result = toDisplayValue(arr);
      expect(result.raw).toBe(arr);
    });

    it('raw contains original object', () => {
      const obj = { $oid: 'abc123' };
      const result = toDisplayValue(obj);
      expect(result.raw).toBe(obj);
    });
  });
});

describe('isRecord', () => {
  it('plain object → true', () => {
    expect(isRecord({})).toBe(true);
  });

  it('array → false', () => {
    expect(isRecord([1, 2])).toBe(false);
  });

  it('null → false', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('primitives → false', () => {
    expect(isRecord('x')).toBe(false);
    expect(isRecord(1)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
  });
});

describe('docKey', () => {
  it('non-record value falls back to idx:<idx>', () => {
    expect(docKey('not a record', 3)).toBe('idx:3');
    expect(docKey(null, 0)).toBe('idx:0');
    expect(docKey([1, 2], 5)).toBe('idx:5');
  });

  it('same document object always returns the same key, regardless of idx', () => {
    const doc = { _id: 'a', name: 'x' };
    const first = docKey(doc, 0);
    expect(docKey(doc, 0)).toBe(first);
    expect(docKey(doc, 99)).toBe(first);
  });

  it('two distinct document objects get distinct keys, even sharing the same _id (e.g. $unwind output)', () => {
    const a = { _id: 'dup' };
    const b = { _id: 'dup' };
    expect(docKey(a, 0)).not.toBe(docKey(b, 1));
  });

  it('two distinct document objects at the same idx (e.g. across a refetch) get distinct keys', () => {
    const before = { name: 'before' };
    const after = { name: 'after' };
    expect(docKey(before, 0)).not.toBe(docKey(after, 0));
  });

  it('record keys are numbered in increasing order across calls', () => {
    const first = docKey({ tag: 'first' }, 0);
    const second = docKey({ tag: 'second' }, 0);
    expect(first).toMatch(/^doc:\d+$/);
    expect(second).toMatch(/^doc:\d+$/);
    expect(Number(second.split(':')[1])).toBeGreaterThan(Number(first.split(':')[1]));
  });
});

describe('valueToClipboardText', () => {
  it('undefined → empty string', () => {
    expect(valueToClipboardText(undefined)).toBe('');
  });

  it('string → returned verbatim, not re-quoted', () => {
    expect(valueToClipboardText('hello world')).toBe('hello world');
  });

  it('empty string → empty string, not confused with undefined', () => {
    expect(valueToClipboardText('')).toBe('');
  });

  it.each([
    ['objectid', { $oid: '507f1f77bcf86cd799439011' }, '507f1f77bcf86cd799439011'],
    ['date', { $date: '2024-01-15T12:00:00.000Z' }, '2024-01-15T12:00:00.000Z'],
    ['long', { $numberLong: '9007199254740993' }, '9007199254740993'],
    ['decimal', { $numberDecimal: '3.14159265358979323846' }, '3.14159265358979323846'],
    ['regex', { $regex: 'abc', $options: 'i' }, '/abc/i'],
    ['number', 42, '42'],
    ['boolean', true, 'true'],
    ['null', null, 'null'],
  ] as const)('%s DisplayValue types pass through as their display string', (_label, input, expected) => {
    expect(valueToClipboardText(input)).toBe(expected);
  });

  it('NaN as a number DisplayValue uses String(v), not JSON.stringify (which would give "null")', () => {
    // Distinguishes the `dv.type === 'number'` term from being always-false:
    // for a finite number String(n) === JSON.stringify(n), so this term is
    // only observable via a value where the two diverge — NaN is such a value.
    expect(valueToClipboardText(NaN)).toBe('NaN');
  });

  it('array falls to the default branch → JSON.stringify', () => {
    expect(valueToClipboardText([1, 2, 3])).toBe('[1,2,3]');
  });

  it('plain object falls to the default branch → JSON.stringify', () => {
    expect(valueToClipboardText({ a: 1 })).toBe('{"a":1}');
  });

  it('binary sentinel falls to the default branch → JSON.stringify, not dv.display', () => {
    const v = { $binary: { base64: 'aGVsbG8=', subType: '00' } };
    expect(valueToClipboardText(v)).toBe(JSON.stringify(v));
  });
});
