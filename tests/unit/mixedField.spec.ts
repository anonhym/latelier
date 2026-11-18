import { describe, it, expect } from 'vitest';
import {
  eitherPlan,
  isEitherRow,
  isMixedSplit,
  mixedHint,
  noEditorText,
  noEditorType,
  valTypeOfSampled,
} from '../../src/pages/Workspace/mixedField';

const ZIP = [
  { type: 'string', share: 62 },
  { type: 'number', share: 38 },
];

describe('isMixedSplit', () => {
  it('is true only with two types and no type at 90%', () => {
    expect(isMixedSplit(ZIP)).toBe(true);
    expect(isMixedSplit([{ type: 'string', share: 90 }, { type: 'number', share: 10 }])).toBe(false);
    expect(isMixedSplit([{ type: 'string', share: 89 }, { type: 'number', share: 11 }])).toBe(true);
    expect(isMixedSplit([{ type: 'string', share: 100 }])).toBe(false);
    expect(isMixedSplit([])).toBe(false);
  });
});

describe('valTypeOfSampled and noEditorType', () => {
  it('maps sampled types that have an editor', () => {
    expect(valTypeOfSampled('number')).toBe('number');
    expect(valTypeOfSampled('binary')).toBeNull();
  });

  it('names a commonest type with no editor, but not documents', () => {
    expect(noEditorType([{ type: 'binary', share: 100 }])).toBe('binary');
    expect(noEditorType([{ type: 'timestamp', share: 60 }, { type: 'string', share: 40 }])).toBe('timestamp');
    expect(noEditorType([{ type: 'string', share: 60 }, { type: 'binary', share: 40 }])).toBeNull();
    expect(noEditorType([{ type: 'object', share: 100 }])).toBeNull();
    expect(noEditorType([{ type: 'undefined', share: 100 }])).toBeNull();
    expect(noEditorType([])).toBeNull();
  });

  it('words the line for binary data and for other types', () => {
    expect(noEditorText('binary')).toBe(
      'No editor for binary data: what you type is compared as text. Use a raw clause for $binary.',
    );
    expect(noEditorText('timestamp')).toBe(
      'No editor for timestamp values: what you type is compared as text. Use a raw clause for $timestamp.',
    );
  });
});

describe('eitherPlan', () => {
  it('makes a $in with one chip per sampled type that can hold the value', () => {
    expect(eitherPlan(ZIP, '75001', 'string')).toEqual({
      label: 'string or number',
      patch: { op: '$in', valType: 'array', value: '["75001",75001]' },
    });
  });

  it('is null when the second type cannot hold the value', () => {
    expect(eitherPlan(ZIP, 'abc', 'string')).toBeNull();
  });

  it('is null for an empty value or fewer than two types', () => {
    expect(eitherPlan(ZIP, '', 'string')).toBeNull();
    expect(eitherPlan([{ type: 'string', share: 100 }], 'x', 'string')).toBeNull();
    expect(eitherPlan([], 'x', 'string')).toBeNull();
  });

  it('is null when the two commonest types would be the same chip', () => {
    const numbers = [{ type: 'number', share: 60 }, { type: 'long', share: 40 }];
    expect(eitherPlan(numbers, '5', 'number')).toBeNull();
  });

  it('is null when a commonest type has no plain chip (a date)', () => {
    const mixed = [{ type: 'string', share: 60 }, { type: 'date', share: 40 }];
    expect(eitherPlan(mixed, '2026-04-01', 'string')).toBeNull();
  });

  it('reads true and false as booleans beside text', () => {
    const mixed = [{ type: 'boolean', share: 60 }, { type: 'string', share: 40 }];
    expect(eitherPlan(mixed, 'true', 'boolean')?.patch.value).toBe('[true,"true"]');
  });

  it('does not repeat a chip when a third type makes the same one', () => {
    const three = [
      { type: 'string', share: 50 },
      { type: 'number', share: 30 },
      { type: 'long', share: 20 },
    ];
    expect(eitherPlan(three, '7', 'string')?.patch.value).toBe('["7",7]');
  });

  it('skips a sampled type that cannot hold the value when listing chips', () => {
    const three = [
      { type: 'string', share: 50 },
      { type: 'number', share: 30 },
      { type: 'boolean', share: 20 },
    ];
    expect(eitherPlan(three, '7', 'string')?.patch.value).toBe('["7",7]');
  });
});

describe('isEitherRow', () => {
  it('needs chips of two kinds that the sample holds', () => {
    expect(isEitherRow(['75001', 75001], ZIP)).toBe(true);
    expect(isEitherRow(['a', 'b'], ZIP)).toBe(false);
    expect(isEitherRow([1, 'a', null], ZIP)).toBe(true);
    expect(isEitherRow([true, 'a'], ZIP)).toBe(false);
    expect(isEitherRow([5, 'a'], [{ type: 'long', share: 50 }, { type: 'string', share: 50 }])).toBe(true);
  });
});

describe('mixedHint', () => {
  it('says what share the value skips', () => {
    expect(mixedHint('zip', ZIP, 'string', '75001', 'string')).toEqual({
      kind: 'skips',
      text: 'Skips the 38% that store zip as a number',
    });
  });

  it('adds every other type to the skipped share', () => {
    const three = [
      { type: 'string', share: 50 },
      { type: 'number', share: 30 },
      { type: 'objectid', share: 20 },
    ];
    expect(mixedHint('id', three, 'string', '7', 'string')?.text).toBe(
      'Skips the 50% that store id as a number or an objectid',
    );
  });

  it('says only the sent type can match when no other type can hold the value', () => {
    expect(mixedHint('address.zip', ZIP, 'string', 'abc', 'string')).toEqual({
      kind: 'only',
      text: 'Not a number, so only text zips can match.',
    });
    expect(mixedHint('zip', ZIP, 'number', '5', 'number')?.kind).toBe('skips');
  });

  it('names a sent type that is not text by its own name', () => {
    const mixed = [{ type: 'date', share: 60 }, { type: 'boolean', share: 40 }];
    expect(mixedHint('d', mixed, 'date', '2026-04-01', 'date')?.text).toBe('Not a boolean, so only date ds can match.');
  });

  it('treats number, long and decimal as one side', () => {
    const mixed = [{ type: 'long', share: 60 }, { type: 'string', share: 40 }];
    expect(mixedHint('n', mixed, 'number', '5', 'number')?.text).toBe('Skips the 40% that store n as a string');
    const onlyNumbers = [{ type: 'long', share: 60 }, { type: 'decimal', share: 40 }];
    expect(mixedHint('n', onlyNumbers, 'number', '5', 'number')).toBeNull();
  });

  it('is silent for an empty value, a sample that is not mixed, or a type the sample lacks', () => {
    expect(mixedHint('zip', ZIP, 'string', '', 'string')).toBeNull();
    expect(mixedHint('zip', [{ type: 'string', share: 100 }], 'string', 'x', 'string')).toBeNull();
    expect(mixedHint('zip', ZIP, 'date', '2026-04-01', 'date')).toBeNull();
  });
});
