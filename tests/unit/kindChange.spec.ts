import { describe, it, expect } from 'vitest';
import type { CondNode, SchemaSampleEntry } from '@shared/types';
import {
  KIND_CHANGE_OPTIONS,
  convertValue,
  convertedNoticeText,
  kindSwitchPatch,
  operatorSwitch,
  planFieldKind,
  removedNoticeText,
  sampleHintText,
  sampleShare,
} from '../../src/pages/Workspace/kindChange';

const cond = (p: Partial<CondNode>): CondNode => ({
  kind: 'cond',
  field: 'qty',
  op: '$eq',
  valType: 'string',
  value: '',
  ...p,
});

describe('convertValue', () => {
  it('converts text that reads as the target kind', () => {
    expect(convertValue('12', 'string', 'number')).toEqual({ kind: 'converted', text: '12' });
    expect(convertValue('12', 'number', 'long')).toEqual({ kind: 'converted', text: '12' });
    expect(convertValue('1.5', 'string', 'decimal')).toEqual({ kind: 'converted', text: '1.5' });
    expect(convertValue('true', 'string', 'boolean')).toEqual({ kind: 'converted', text: 'true' });
    expect(convertValue('2026-04-01', 'string', 'date')).toEqual({ kind: 'converted', text: '2026-04-01' });
    expect(convertValue('507f1f77bcf86cd799439011', 'string', 'objectid')).toEqual({
      kind: 'converted',
      text: '507f1f77bcf86cd799439011',
    });
  });

  it('reads false as a boolean, and only a whole ISO date as a date', () => {
    expect(convertValue('false', 'string', 'boolean')).toEqual({ kind: 'converted', text: 'false' });
    expect(convertValue('x2026-04-01', 'string', 'date')).toEqual({ kind: 'keep' });
    expect(convertValue('26-04-01', 'string', 'date')).toEqual({ kind: 'keep' });
    expect(convertValue('2026-4-01', 'string', 'date')).toEqual({ kind: 'keep' });
  });

  it('keeps text that does not read as the target kind', () => {
    expect(convertValue('abc', 'string', 'number')).toEqual({ kind: 'keep' });
    expect(convertValue('1.5', 'number', 'long')).toEqual({ kind: 'keep' });
    expect(convertValue('yes', 'string', 'boolean')).toEqual({ kind: 'keep' });
    expect(convertValue('TRUE', 'string', 'boolean')).toEqual({ kind: 'keep' });
    expect(convertValue('12', 'string', 'date')).toEqual({ kind: 'keep' });
    expect(convertValue('2026-13-45', 'string', 'date')).toEqual({ kind: 'keep' });
    expect(convertValue('507f', 'string', 'objectid')).toEqual({ kind: 'keep' });
  });

  it('keeps a number past the safe integer range', () => {
    expect(convertValue('9007199254740993', 'string', 'number')).toEqual({ kind: 'keep' });
    expect(convertValue('9007199254740993', 'string', 'long')).toEqual({
      kind: 'converted',
      text: '9007199254740993',
    });
  });

  it('keeps an empty box, whatever the kinds', () => {
    expect(convertValue('', 'string', 'number')).toEqual({ kind: 'keep' });
    expect(convertValue('', 'string', 'string')).toEqual({ kind: 'keep' });
  });

  it('leaves text alone when the kind does not change', () => {
    expect(convertValue('abc', 'string', 'string')).toEqual({ kind: 'converted', text: 'abc' });
    expect(convertValue('abc', 'number', 'number')).toEqual({ kind: 'converted', text: 'abc' });
  });

  it('reads any text as a string, blanks included', () => {
    expect(convertValue(' 7 ', 'number', 'string')).toEqual({ kind: 'converted', text: ' 7 ' });
  });

  it('keeps blanks for a kind that cannot hold them', () => {
    expect(convertValue('  ', 'string', 'number')).toEqual({ kind: 'keep' });
  });

  it('keeps anything to or from a kind with no single text', () => {
    expect(convertValue('1', 'string', 'null')).toEqual({ kind: 'keep' });
    expect(convertValue('1', 'string', 'array')).toEqual({ kind: 'keep' });
    expect(convertValue('1', 'string', 'regex')).toEqual({ kind: 'keep' });
    expect(convertValue('1', 'array', 'string')).toEqual({ kind: 'keep' });
    expect(convertValue('1', 'null', 'number')).toEqual({ kind: 'keep' });
  });
});

describe('kindSwitchPatch', () => {
  it('carries a readable value over with the new type', () => {
    expect(kindSwitchPatch(cond({ value: '12' }), 'number')).toEqual({ valType: 'number', op: '$eq', value: '12' });
  });

  it('keeps an unreadable value, changing only the type', () => {
    expect(kindSwitchPatch(cond({ value: 'abc' }), 'number')).toStrictEqual({ valType: 'number', op: '$eq' });
  });

  it('changes only the type when automatic conversion is off', () => {
    expect(kindSwitchPatch(cond({ value: '12' }), 'number', { autoConvert: false })).toEqual({
      valType: 'number',
      op: '$eq',
    });
  });

  it('changes the operator the new type does not offer', () => {
    expect(kindSwitchPatch(cond({ op: '$regex', value: 'a' }), 'number')).toEqual({ valType: 'number', op: '$eq' });
  });

  it('does not convert for an operator that is not a plain comparison', () => {
    expect(kindSwitchPatch(cond({ op: '$in', value: '["1"]' }), 'number')).toEqual({ valType: 'number', op: '$in' });
  });
});

describe('sampleShare', () => {
  const entry = (types: Record<string, number>): SchemaSampleEntry =>
    ({ path: 'qty', types, frequency: 1, distinct: 1 }) as unknown as SchemaSampleEntry;

  it('says every only when one type holds every counted document', () => {
    expect(sampleShare(entry({ number: 40 }))).toBe('every');
    expect(sampleShare(entry({ number: 995, string: 5 }))).toBe('most');
  });

  it('says nothing without a sample', () => {
    expect(sampleShare(undefined)).toBeNull();
    expect(sampleShare(entry({}))).toBeNull();
    expect(sampleShare(entry({ number: 0 }))).toBeNull();
  });
});

describe('planFieldKind', () => {
  it('has the empty box adopt the type, and the operator it needs', () => {
    expect(planFieldKind(cond({ op: '$regex' }), 'number', 'every')).toEqual({
      kind: 'adopt',
      patch: { valType: 'number', op: '$eq' },
    });
  });

  it('adopts without evidence for an empty box', () => {
    expect(planFieldKind(cond({}), 'number', null)).toEqual({
      kind: 'adopt',
      patch: { valType: 'number', op: '$eq' },
    });
  });

  it('does nothing when the empty box already has the type and an operator for it', () => {
    expect(planFieldKind(cond({ valType: 'number' }), 'number', 'every')).toEqual({ kind: 'none' });
  });

  it('adopts a type for an empty box that has the type but not the operator', () => {
    expect(planFieldKind(cond({ valType: 'number', op: '$regex' }), 'number', 'every')).toEqual({
      kind: 'adopt',
      patch: { valType: 'number', op: '$eq' },
    });
  });

  it('leaves a null row alone', () => {
    expect(planFieldKind(cond({ valType: 'null' }), 'number', 'every')).toEqual({ kind: 'none' });
  });

  it('converts a readable value', () => {
    expect(planFieldKind(cond({ value: '12' }), 'number', 'every')).toEqual({
      kind: 'convert',
      to: 'number',
      patch: { valType: 'number', op: '$eq', value: '12' },
    });
  });

  it('offers the type for a value that does not read as it', () => {
    expect(planFieldKind(cond({ value: 'abc' }), 'number', 'most')).toEqual({
      kind: 'hint',
      to: 'number',
      share: 'most',
    });
  });

  it('only offers a readable value when automatic conversion is off', () => {
    expect(planFieldKind(cond({ value: '12' }), 'number', 'every', { autoConvert: false })).toEqual({
      kind: 'hint',
      to: 'number',
      share: 'every',
    });
  });

  it('does nothing for a value when there is no sample evidence', () => {
    expect(planFieldKind(cond({ value: '12' }), 'number', null)).toEqual({ kind: 'none' });
  });

  it('does nothing when the value already has the sampled type', () => {
    expect(planFieldKind(cond({ value: '12', valType: 'number' }), 'number', 'every')).toEqual({ kind: 'none' });
  });

  it('does nothing for an operator that is not a plain comparison', () => {
    expect(planFieldKind(cond({ op: '$regex', value: 'a.*' }), 'number', 'every')).toEqual({ kind: 'none' });
  });

  it('treats a value of blanks as empty', () => {
    expect(planFieldKind(cond({ value: '  ' }), 'number', 'every').kind).toBe('adopt');
  });

  it('defaults to the shared options', () => {
    expect(KIND_CHANGE_OPTIONS.autoConvert).toBe(true);
    expect(planFieldKind(cond({ value: '12' }), 'number', 'every').kind).toBe('convert');
  });
});

describe('notice text', () => {
  it('names the type and the field', () => {
    expect(convertedNoticeText('number', 'qty')).toBe('Changed to number to match qty');
  });

  it('says every or most, with the right article', () => {
    expect(sampleHintText('qty', 'number', 'every')).toBe('qty is a number in every sampled document');
    expect(sampleHintText('_id', 'objectid', 'most')).toBe('_id is an objectid in most sampled documents');
  });

  it('lists the first removed names, then how many more', () => {
    expect(removedNoticeText(['b'])).toBe('b was removed');
    expect(removedNoticeText(['b', 'c'])).toBe('b, c were removed');
    expect(removedNoticeText(['a', 'b', 'c'])).toBe('a, b, c were removed');
    expect(removedNoticeText(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more were removed');
  });
});

describe('operatorSwitch', () => {
  it('= to $in makes the value the first chip', () => {
    expect(operatorSwitch(cond({ value: 'a' }), '$in')).toEqual({ value: '["a"]', removed: [] });
  });

  it('= to $in keeps a string verbatim: padding and quotes are part of the value', () => {
    expect(operatorSwitch(cond({ value: '  a  ' }), '$in')).toEqual({ value: '["  a  "]', removed: [] });
    expect(operatorSwitch(cond({ value: '"hello"' }), '$in')).toEqual({ value: '["\\"hello\\""]', removed: [] });
  });

  it('= to $in types the chip by the row', () => {
    expect(operatorSwitch(cond({ valType: 'number', value: '5' }), '$in')).toEqual({ value: '[5]', removed: [] });
  });

  it('= to $in keeps an empty box empty', () => {
    expect(operatorSwitch(cond({ value: '' }), '$in')).toEqual({ value: '', removed: [] });
  });

  it('$in to = keeps the first chip and lists the rest', () => {
    expect(operatorSwitch(cond({ op: '$in', value: '["a","b","c"]' }), '$eq')).toEqual({
      value: 'a',
      removed: ['b', 'c'],
    });
  });

  it('$in to = on a single chip removes nothing', () => {
    expect(operatorSwitch(cond({ op: '$in', valType: 'number', value: '[5]' }), '$eq')).toEqual({
      value: '5',
      removed: [],
    });
  });

  it('$in to = on an empty list empties the box', () => {
    expect(operatorSwitch(cond({ op: '$in', value: '[]' }), '$eq')).toEqual({ value: '', removed: [] });
  });

  it('a loaded list is typed by its first chip', () => {
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '["a","b"]' }), '$eq')).toEqual({
      value: 'a',
      valType: 'string',
      removed: ['b'],
    });
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '[7,8]' }), '$eq')).toEqual({
      value: '7',
      valType: 'number',
      removed: ['8'],
    });
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '[true]' }), '$eq')).toEqual({
      value: 'true',
      valType: 'boolean',
      removed: [],
    });
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '[null,1]' }), '$eq')).toEqual({
      value: '',
      valType: 'null',
      removed: ['1'],
    });
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '[]' }), '$eq')).toEqual({
      value: '',
      valType: 'string',
      removed: [],
    });
  });

  it('quotes a removed name that would read as something else', () => {
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '["1","x"]' }), '$eq')?.removed).toEqual(['x']);
    expect(operatorSwitch(cond({ op: '$in', valType: 'array', value: '["a","1"]' }), '$eq')?.removed).toEqual(['"1"']);
  });

  it('a null chip in a typed row reads as the text null', () => {
    expect(operatorSwitch(cond({ op: '$in', valType: 'number', value: '[null,1]' }), '$eq')).toEqual({
      value: 'null',
      removed: ['1'],
    });
  });

  it('does nothing when the operator stays', () => {
    expect(operatorSwitch(cond({ op: '$in', value: '["a","b"]' }), '$in')).toBeNull();
    expect(operatorSwitch(cond({ op: '$eq', value: 'a' }), '$eq')).toBeNull();
  });

  it('leaves a list no chip can hold, and any other operator change, alone', () => {
    expect(operatorSwitch(cond({ op: '$in', value: '[{"a":1}]' }), '$eq')).toBeNull();
    expect(operatorSwitch(cond({ op: '$ne', value: 'a' }), '$in')).toBeNull();
    expect(operatorSwitch(cond({ op: '$eq', value: 'a' }), '$gt')).toBeNull();
    expect(operatorSwitch(cond({ valType: 'null' }), '$in')).toBeNull();
    expect(operatorSwitch(cond({ op: '$in', valType: 'regex', value: '["a"]' }), '$eq')).toBeNull();
  });
});
