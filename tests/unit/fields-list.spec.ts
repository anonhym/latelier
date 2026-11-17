import { describe, it, expect } from 'vitest';
import {
  documentsHold,
  fieldType,
  isDottedPath,
  isFieldChecked,
  knownFields,
  modeTag,
  operatorLabel,
  rememberedOrder,
  tabKnownFields,
} from '../../src/pages/Workspace/fieldsList';
import { projectionMode } from '../../src/pages/Workspace/projection';
import type { BuilderState, CollectionTabState } from '@shared/types';

const builder = (over: Partial<BuilderState> = {}): BuilderState => ({ projection: [], sort: '', limit: '', ...over });
const mode = (over: Partial<BuilderState> = {}) => projectionMode(builder(over));

describe('knownFields', () => {
  it('lists the results\' fields, the projection\'s, the dotted columns and the remembered order', () => {
    const docs = [{ _id: 1, a: 1 }];
    const info = mode({ projection: ['b'] });
    expect(knownFields(docs, info, ['x.y'], ['z'])).toEqual(['z', '_id', 'a', 'b', 'x.y']);
  });

  it('is empty before a first run, rather than offering a lone _id', () => {
    expect(knownFields([], mode(), [], undefined)).toEqual([]);
  });

  it('keeps a projection\'s field when no result holds it', () => {
    expect(knownFields([{ _id: 1 }], mode({ projectionRaw: '{"gone":0}' }), [], undefined)).toEqual(['_id', 'gone']);
  });
});

describe('isFieldChecked', () => {
  it('everything is checked with no projection or an unreadable one', () => {
    expect(isFieldChecked(mode(), 'a')).toBe(true);
    expect(isFieldChecked(mode({ projectionRaw: '{"a":' }), 'a')).toBe(true);
  });

  it('an inclusion checks what it names, and _id unless excluded', () => {
    const info = mode({ projection: ['a'] });
    expect(isFieldChecked(info, 'a')).toBe(true);
    expect(isFieldChecked(info, 'b')).toBe(false);
    expect(isFieldChecked(info, '_id')).toBe(true);
    expect(isFieldChecked(mode({ projectionRaw: '{"a":1,"_id":0}' }), '_id')).toBe(false);
  });

  it('an inclusion covers a dotted path under a named parent and a parent of a named path', () => {
    const info = mode({ projection: ['a', 'c.d'] });
    expect(isFieldChecked(info, 'a.b')).toBe(true);
    expect(isFieldChecked(info, 'c')).toBe(true);
    expect(isFieldChecked(info, 'c.e')).toBe(false);
    expect(isFieldChecked(info, 'ab')).toBe(false);
  });

  it('an exclusion unchecks what it names and what lies under it', () => {
    const info = mode({ projectionRaw: '{"a":0}' });
    expect(isFieldChecked(info, 'a')).toBe(false);
    expect(isFieldChecked(info, 'a.b')).toBe(false);
    expect(isFieldChecked(info, 'ab')).toBe(true);
    expect(isFieldChecked(info, 'b')).toBe(true);
  });
});

describe('documentsHold / fieldType', () => {
  const docs = [{ _id: 1, a: { b: 'x' } }, { _id: 2, n: 3 }];

  it('finds a top-level or dotted path in any document', () => {
    expect(documentsHold(docs, 'n')).toBe(true);
    expect(documentsHold(docs, 'a.b')).toBe(true);
    expect(documentsHold(docs, 'a.c')).toBe(false);
    expect(documentsHold(docs, 'zz')).toBe(false);
  });

  it('names the type of the first value found', () => {
    expect(fieldType(docs, 'a')).toBe('object');
    expect(fieldType(docs, 'a.b')).toBe('string');
    expect(fieldType(docs, 'n')).toBe('number');
    expect(fieldType(docs, 'zz')).toBeNull();
  });
});

describe('operatorLabel', () => {
  it('reads a single operator as `$op: value`', () => {
    expect(operatorLabel({ $slice: 3 })).toBe('$slice: 3');
    expect(operatorLabel({ $slice: [1, 2] })).toBe('$slice: [1,2]');
  });

  it('shows any other value as it is', () => {
    expect(operatorLabel({ $a: 1, $b: 2 })).toBe('{"$a":1,"$b":2}');
    expect(operatorLabel('$name')).toBe('"$name"');
  });
});

describe('modeTag', () => {
  it('counts what the projection names', () => {
    expect(modeTag(mode())).toBe('All fields');
    expect(modeTag(mode({ projection: ['a', 'b'] }))).toBe('Including 2');
    expect(modeTag(mode({ projectionRaw: '{"a":0,"b":0,"c":0}' }))).toBe('Excluding 3');
  });

  it('does not count an _id: 0 beside an inclusion as an included field', () => {
    expect(modeTag(mode({ projectionRaw: '{"a":1,"_id":0}' }))).toBe('Including 1');
  });

  it('adds custom when an operator is present', () => {
    expect(modeTag(mode({ projectionRaw: '{"a":{"$slice":2},"b":0}' }))).toBe('Excluding 1 · custom');
    expect(modeTag(mode({ projectionRaw: '{"a":{"$slice":2}}' }))).toBe('All fields · custom');
  });

  it('says when it cannot read the projection', () => {
    expect(modeTag(mode({ projectionRaw: '{"a":' }))).toBe("Can't read this projection");
  });
});

describe('isDottedPath', () => {
  it('accepts a path with every segment named', () => {
    expect(isDottedPath('address.city')).toBe(true);
    expect(isDottedPath('a.b.c')).toBe(true);
  });

  it('refuses a plain name, an empty segment, an operator and whitespace', () => {
    expect(isDottedPath('address')).toBe(false);
    expect(isDottedPath('a..b')).toBe(false);
    expect(isDottedPath('.a')).toBe(false);
    expect(isDottedPath('a.')).toBe(false);
    expect(isDottedPath('a.$b')).toBe(false);
    expect(isDottedPath('a. b')).toBe(false);
  });
});

describe('isFieldChecked — fine print', () => {
  it('an _id kept with a 1 beside exclusions is not an exclusion, so its row stays checked', () => {
    const info = mode({ projectionRaw: '{"x":0,"_id":1}' });
    expect(info.mode).toBe('exclusion');
    expect(isFieldChecked(info, '_id')).toBe(true);
    expect(isFieldChecked(info, 'x')).toBe(false);
  });

  it('an _id kept with a 1 is checked, and only an _id of 0 unchecks it', () => {
    expect(isFieldChecked(mode({ projectionRaw: '{"_id":1,"a":1}' }), '_id')).toBe(true);
  });

  it('with several exclusions, each one unchecks its own row', () => {
    const info = mode({ projectionRaw: '{"a":0,"b":0}' });
    expect(isFieldChecked(info, 'a')).toBe(false);
    expect(isFieldChecked(info, 'b')).toBe(false);
    expect(isFieldChecked(info, 'a.x')).toBe(false);
    expect(isFieldChecked(info, 'c')).toBe(true);
  });
});

describe('fieldType — fine print', () => {
  it('reads no further than the first 50 documents', () => {
    const docs: unknown[] = Array.from({ length: 50 }, () => ({}));
    docs.push({ late: 1 });
    expect(fieldType(docs, 'late')).toBeNull();
    expect(fieldType(docs.slice(1), 'late')).not.toBeNull();
  });

  it('skips a result that is not a document', () => {
    expect(fieldType(['abc', 7, null, ['z']], '0')).toBeNull();
    expect(fieldType([null, { a: 1 }], 'a')).not.toBeNull();
  });

  it('moves on from a document whose field is undefined to one that holds a value', () => {
    expect(fieldType([{ a: undefined }, { a: 'text' }], 'a')).toBe(fieldType([{ a: 'text' }], 'a'));
    expect(fieldType([{ a: undefined }], 'a')).toBeNull();
  });
});

describe('operatorLabel — fine print', () => {
  it('reads a null value without looking for operator keys', () => {
    expect(operatorLabel(null)).toBe('null');
  });

  it('shows a one-key document whole unless that key is an operator', () => {
    expect(operatorLabel({ x: 1 })).toBe('{"x":1}');
    expect(operatorLabel({ $slice: 3 })).toBe('$slice: 3');
  });
});

const tab = (over: Partial<CollectionTabState> = {}): CollectionTabState => ({
  view: 'Table',
  builder: builder(),
  queryRaw: '{}',
  page: 0,
  pageSize: 50,
  activeBuilderTab: 'Builder',
  ...over,
});

describe('tabKnownFields', () => {
  it('reads the projection, the computed columns and the order off the tab it is given', () => {
    const prev = tab({
      builder: builder({ projection: ['b'] }),
      columnConfig: { order: ['z'], computed: [{ id: 'c', path: 'x.y' }] },
    });
    expect(tabKnownFields(prev, [{ _id: 1, a: 1 }])).toEqual(['z', '_id', 'a', 'b', 'x.y']);
  });

  it('needs no column config at all', () => {
    expect(tabKnownFields(tab({ builder: builder({ projection: ['b'] }) }), [{ _id: 1 }])).toEqual(['_id', 'b']);
  });
});

describe('rememberedOrder', () => {
  it('records the known list as the order when the order lacks a field, keeping the rest of the config', () => {
    const prev = tab({ columnConfig: { order: ['a'], computed: [{ id: 'c', path: 'x.y' }] } });
    expect(rememberedOrder(prev, ['a', 'b'])).toEqual({
      columnConfig: { order: ['a', 'b'], computed: [{ id: 'c', path: 'x.y' }] },
    });
  });

  it('records it when the tab has no order yet', () => {
    expect(rememberedOrder(tab(), ['a', 'b'])).toEqual({ columnConfig: { order: ['a', 'b'] } });
  });

  it('writes nothing when the order already names every field', () => {
    expect(rememberedOrder(tab({ columnConfig: { order: ['b', 'a', 'x'] } }), ['a', 'b'])).toEqual({});
    expect(rememberedOrder(tab(), [])).toEqual({});
  });

  it('copies the known list rather than sharing it', () => {
    const known = ['a'];
    const patch = rememberedOrder(tab(), known) as { columnConfig: { order: string[] } };
    expect(patch.columnConfig.order).not.toBe(known);
  });
});
