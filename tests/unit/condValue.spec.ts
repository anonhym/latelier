import { describe, it, expect } from 'vitest';
import {
  isObjectIdHex,
  DATE_PRESETS,
  datePresetValue,
  localInputToIso,
  isoToLocalInput,
  chipsFromValue,
  chipText,
  parseChipText,
  valueFromChips,
  SIMPLE_OPS,
  ARRAY_VALUE_OPS,
  condTypeWarning,
} from '../../src/pages/Workspace/condValue';
import { summarizeSchema } from '../../src/pages/Workspace/schemaSummary';
import type { CondNode, ValType } from '@shared/types';

const NOW = new Date('2026-10-15T12:00:00.000Z');

describe('isObjectIdHex', () => {
  it('accepts 24 hex characters in either case, ignoring surrounding spaces', () => {
    expect(isObjectIdHex('0123456789abcdef01234567')).toBe(true);
    expect(isObjectIdHex('0123456789ABCDEF01234567')).toBe(true);
    expect(isObjectIdHex('  0123456789abcdef01234567  ')).toBe(true);
  });

  it('rejects the wrong length and non-hex characters', () => {
    expect(isObjectIdHex('0123456789abcdef0123456')).toBe(false);
    expect(isObjectIdHex('0123456789abcdef012345678')).toBe(false);
    expect(isObjectIdHex('0123456789abcdef0123456g')).toBe(false);
    expect(isObjectIdHex('x0123456789abcdef01234567')).toBe(false);
    expect(isObjectIdHex('0123456789abcdef01234567x')).toBe(false);
  });
});

describe('date presets', () => {
  it('lists every preset under the label the menu shows', () => {
    expect(DATE_PRESETS).toEqual([
      { id: 'now', label: 'Now' },
      { id: 'startOfToday', label: 'Start of today' },
      { id: '7d', label: '7 days ago' },
      { id: '30d', label: '30 days ago' },
      { id: 'startOfMonth', label: 'Start of this month' },
    ]);
  });

  it('counts 7 and 30 days back from now to the millisecond', () => {
    expect(datePresetValue('7d', NOW)).toBe('2026-10-08T12:00:00.000Z');
    expect(datePresetValue('30d', NOW)).toBe('2026-09-15T12:00:00.000Z');
  });

  it('puts the day and month boundaries at local midnight', () => {
    const y = NOW.getFullYear();
    const m = NOW.getMonth();
    expect(datePresetValue('startOfToday', NOW)).toBe(new Date(y, m, NOW.getDate()).toISOString());
    expect(datePresetValue('startOfMonth', NOW)).toBe(new Date(y, m, 1).toISOString());
  });

  it('gives now as itself', () => {
    expect(datePresetValue('now', NOW)).toBe(NOW.toISOString());
  });
});

describe('datetime-local conversion', () => {
  it('reads the input as local time', () => {
    expect(localInputToIso('2026-10-15T09:30')).toBe(new Date('2026-10-15T09:30').toISOString());
  });

  it('gives "" for text that is not a date', () => {
    expect(localInputToIso('x')).toBe('');
    expect(localInputToIso('')).toBe('');
    expect(isoToLocalInput('bad')).toBe('');
    expect(isoToLocalInput('')).toBe('');
  });

  it('writes local minutes, zero-padded', () => {
    const d = new Date(2026, 0, 5, 7, 3, 59);
    expect(isoToLocalInput(d.toISOString())).toBe('2026-01-05T07:03');
  });
});

describe('chips', () => {
  it('reads a JSON array of primitives', () => {
    expect(chipsFromValue('["a",1,true,null]')).toEqual(['a', 1, true, null]);
    expect(chipsFromValue('  ')).toEqual([]);
    expect(chipsFromValue('')).toEqual([]);
  });

  it('refuses anything a chip cannot show', () => {
    expect(chipsFromValue('[{"$oid":"0123456789abcdef01234567"}]')).toBeNull();
    expect(chipsFromValue('[[1]]')).toBeNull();
    expect(chipsFromValue('garbage')).toBeNull();
    expect(chipsFromValue('{}')).toBeNull();
    expect(chipsFromValue('"a"')).toBeNull();
  });

  it('keeps an integer past 2^53 out of chips, where it would be rounded', () => {
    expect(chipsFromValue('[9007199254740993]')).toBeNull();
    expect(chipsFromValue('[9007199254740991, 1.5]')).toEqual([9007199254740991, 1.5]);
  });

  it('reads typed chip text as the value it looks like', () => {
    expect(parseChipText('42')).toBe(42);
    expect(parseChipText('-1.5')).toBe(-1.5);
    expect(parseChipText('.5')).toBe(0.5);
    expect(parseChipText('.55')).toBe(0.55);
    expect(parseChipText('1e3')).toBe(1000);
    expect(parseChipText('2.E-2')).toBe(0.02);
    expect(parseChipText('true')).toBe(true);
    expect(parseChipText('false')).toBe(false);
    expect(parseChipText('null')).toBeNull();
    expect(parseChipText('"42"')).toBe('42');
    expect(parseChipText(' a ')).toBe('a');
    expect(parseChipText('abc')).toBe('abc');
    expect(parseChipText('1.2.3')).toBe('1.2.3');
    expect(parseChipText('x42')).toBe('x42');
    expect(parseChipText('42x')).toBe('42x');
    expect(parseChipText('"a')).toBe('"a');
    expect(parseChipText('"\\"')).toBe('"\\"');
    expect(parseChipText('1e999')).toBe('1e999');
    // Text `Number()` would read but a person means as text.
    expect(parseChipText('')).toBe('');
    expect(parseChipText('0x10')).toBe('0x10');
    expect(parseChipText('0b1')).toBe('0b1');
    expect(parseChipText('+5')).toBe('+5');
    expect(parseChipText('1e')).toBe('1e');
    expect(parseChipText('-')).toBe('-');
    expect(parseChipText('.')).toBe('.');
    // JSON that isn't a string literal stays text.
    expect(parseChipText('[1]')).toBe('[1]');
    expect(parseChipText('{"a":1}')).toBe('{"a":1}');
  });

  it('quotes a string chip only when its plain text would read as something else', () => {
    expect(chipText('abc')).toBe('abc');
    expect(chipText('42')).toBe('"42"');
    expect(chipText('true')).toBe('"true"');
    expect(chipText(' a')).toBe('" a"');
    expect(chipText(42)).toBe('42');
    expect(chipText(false)).toBe('false');
    expect(chipText(null)).toBe('null');
  });

  it('writes chips back as a JSON array', () => {
    expect(valueFromChips(['a', 1])).toBe('["a",1]');
    expect(valueFromChips([])).toBe('[]');
  });
});

describe('operator sets', () => {
  it('names the scalar and array-value operators', () => {
    expect([...SIMPLE_OPS]).toEqual(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
    expect([...ARRAY_VALUE_OPS]).toEqual(['$in', '$nin', '$all']);
  });
});

describe('condTypeWarning', () => {
  const entries = new Map(
    summarizeSchema(Array(10).fill({ status: 'a', n: 1, tags: ['x'], mixed: 1 }).concat(
      Array(2).fill({ mixed: 'b' }),
    )).map((e) => [e.path, e]),
  );
  const cond = (field: string, op: string, valType: ValType, value = ''): CondNode => ({
    kind: 'cond',
    field,
    op,
    valType,
    value,
  });

  it('warns when the value type disagrees with what the sample holds', () => {
    expect(condTypeWarning(entries, cond('status', '$eq', 'number', '5'))).toEqual({
      field: 'status',
      expectedType: 'string',
      actualType: 'number',
      percent: 100,
    });
    for (const [vt, actual] of [
      ['long', 'long'],
      ['decimal', 'decimal'],
      ['boolean', 'boolean'],
      ['date', 'date'],
      ['objectid', 'objectid'],
    ] as const) {
      expect(condTypeWarning(entries, cond('status', '$gt', vt))?.actualType).toBe(actual);
    }
    expect(condTypeWarning(entries, cond('n', '$lte', 'string', 'x'))?.expectedType).toBe('number');
  });

  it('is silent when the value type agrees', () => {
    expect(condTypeWarning(entries, cond('status', '$eq', 'string', 'a'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$ne', 'string'))).toBeNull();
  });

  it('treats number, long and decimal as one family', () => {
    expect(condTypeWarning(entries, cond('n', '$eq', 'long', '1'))).toBeNull();
    expect(condTypeWarning(entries, cond('n', '$eq', 'decimal', '1'))).toBeNull();
  });

  it('checks a list by its first non-null element, as it is sent', () => {
    expect(condTypeWarning(entries, cond('status', '$in', 'array', '[null,1,2]'))?.actualType).toBe('number');
    expect(condTypeWarning(entries, cond('status', '$nin', 'array', '[1]'))?.actualType).toBe('number');
    expect(condTypeWarning(entries, cond('status', '$in', 'array', '["a"]'))).toBeNull();
    // A string-typed list sends every element as a string.
    expect(condTypeWarning(entries, cond('status', '$in', 'string', '[1,2]'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$in', 'array', '[]'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$in', 'array', '[null]'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$in', 'array', 'oops'))).toBeNull();
  });

  it('stays silent where a type comparison means nothing', () => {
    // An array field matches its elements, so the field's own type says nothing.
    expect(condTypeWarning(entries, cond('tags', '$eq', 'string', 'x'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$exists', 'string', 'true'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$type', 'string', 'number'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$regex', 'regex', 'a'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$all', 'array', '[1]'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$eq', 'null'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$eq', 'regex', 'a'))).toBeNull();
    expect(condTypeWarning(entries, cond('status', '$eq', 'array', '[1]'))).toBeNull();
    expect(condTypeWarning(entries, cond('nope', '$eq', 'number', '1'))).toBeNull();
    expect(condTypeWarning(entries, cond('', '$eq', 'number', '1'))).toBeNull();
    expect(condTypeWarning(entries, cond('  ', '$eq', 'number', '1'))).toBeNull();
    // A field the sample shows as mixed has no type to disagree with.
    expect(condTypeWarning(entries, cond('mixed', '$eq', 'boolean', 'true'))).toBeNull();
  });

  it('is silent for a blank field even when the sample has an empty-named field', () => {
    // A blank field is a pending row, never printed, so nothing to warn about.
    const withEmptyKey = new Map(summarizeSchema(Array(3).fill({ '': 'a' })).map((e) => [e.path, e]));
    expect(withEmptyKey.has('')).toBe(true);
    expect(condTypeWarning(withEmptyKey, cond('', '$eq', 'number', '1'))).toBeNull();
  });

  it('looks the field up by its trimmed name', () => {
    expect(condTypeWarning(entries, cond(' status ', '$eq', 'number', '5'))?.field).toBe('status');
  });
});
