import { describe, it, expect } from 'vitest';
import {
  migrateHiddenColumns,
  migrateHiddenSeed,
  migrationPatch,
  onlyRemovesFields,
  projectionPatch,
  toggleProjectionField,
} from '../../src/pages/Workspace/projectionWriter';
import {
  hiddenFieldNames,
  projectedOutFields,
  projectionHider,
  projectionMode,
  projectionPathHider,
  redactHidden,
} from '../../src/pages/Workspace/projection';
import { resultQueryKey } from '../../src/pages/Workspace/builder';
import { isResultStale } from '../../src/pages/Workspace/resultPaneState';
import type { BuilderState, CollectionTabState } from '@shared/types';

const ORDER = ['_id', 'a', 'b', 'c', 'd'];

const none = (): BuilderState => ({ projection: [], sort: '', limit: '' });
const inc = (...fields: string[]): BuilderState => ({ ...none(), projection: fields });
const raw = (doc: string): BuilderState => ({ ...none(), projectionRaw: doc });

const off = (b: BuilderState, f: string, order: readonly string[] = ORDER) => toggleProjectionField(b, f, false, order);
const on = (b: BuilderState, f: string, order: readonly string[] = ORDER) => toggleProjectionField(b, f, true, order);

// Every assertion on a written projection goes through what the server would
// be sent, so a modelled list and its raw twin read the same.
const sent = (b: BuilderState) => {
  const { entries } = projectionMode(b);
  return Object.fromEntries(entries.map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]));
};

describe('projectionMode', () => {
  it('no projection, an inclusion and an exclusion', () => {
    expect(projectionMode(none())).toEqual({ mode: 'none', entries: [], locked: [] });
    expect(projectionMode(inc('a', 'b'))).toEqual({
      mode: 'inclusion',
      entries: [['a', 1], ['b', 1]],
      locked: [],
    });
    expect(projectionMode(raw('{"a":0,"b":0}')).mode).toBe('exclusion');
  });

  it('keeps the entries in the order they were written', () => {
    expect(projectionMode(raw('{"b":0,"a":0}')).entries.map(([k]) => k)).toEqual(['b', 'a']);
  });

  it('{_id: 1} alone is an inclusion and {_id: 0} alone an exclusion', () => {
    expect(projectionMode(raw('{"_id":1}')).mode).toBe('inclusion');
    expect(projectionMode(raw('{"_id":0}')).mode).toBe('exclusion');
    expect(projectionMode(raw('{"a":1,"_id":0}')).mode).toBe('inclusion');
  });

  it('a $slice-only projection behaves like none, with its row locked', () => {
    expect(projectionMode(raw('{"tags":{"$slice":3}}'))).toMatchObject({ mode: 'none', locked: ['tags'] });
  });

  it('an operator or expression is locked; a 1, a true and a 0 are not', () => {
    const info = projectionMode(raw('{"a":1,"b":true,"c":{"$elemMatch":{"x":1}},"d":"$a","e":2}'));
    expect(info.mode).toBe('inclusion');
    expect(info.locked).toEqual(['c', 'd', 'e']);
    expect(projectionMode(raw('{"a":0,"b":false}')).locked).toEqual([]);
  });

  it('reads a boxed numeric flag as a flag', () => {
    expect(projectionMode(raw('{"a":{"$numberInt":"0"}}'))).toMatchObject({ mode: 'exclusion', locked: [] });
    expect(projectionMode(raw('{"a":{"$numberInt":"1"}}'))).toMatchObject({ mode: 'inclusion', locked: [] });
  });

  it('a raw projection the app cannot read is invalid, not none', () => {
    expect(projectionMode(raw('{"a":'))).toEqual({ mode: 'invalid', entries: [], locked: [] });
    expect(projectionMode(raw('[1]')).mode).toBe('invalid');
  });

  it('a blank raw projection falls back to the modelled list', () => {
    expect(projectionMode({ ...inc('a'), projectionRaw: '   ' }).mode).toBe('inclusion');
  });
});

describe('projectedOutFields', () => {
  const known = ['_id', 'a', 'b'];
  it('names the known fields the projection keeps off the wire', () => {
    expect(projectedOutFields(raw('{"a":0}'), known)).toEqual(['a']);
    expect(projectedOutFields(inc('a'), known)).toEqual(['b']);
  });
  it('leaves out an excluded field no result holds', () => {
    expect(projectedOutFields(raw('{"zzz":0}'), known)).toEqual([]);
  });
  it('hides nothing without a builder or without a projection', () => {
    expect(projectedOutFields(undefined, known)).toEqual([]);
    expect(projectedOutFields(none(), known)).toEqual([]);
  });
});

describe('toggleProjectionField — from no projection', () => {
  it('unchecking writes an exclusion of that field, never an inclusion of the rest', () => {
    const next = off(none(), 'b');
    expect(next).toEqual({ projection: [], projectionRaw: '{"b":0}', sort: '', limit: '' });
  });

  it('keeps the rest of the builder', () => {
    const base = { ...none(), sort: '{"a":1}', limit: '5', hint: 'x' };
    expect(off(base, 'a')).toMatchObject({ sort: '{"a":1}', limit: '5', hint: 'x' });
  });

  it('checking a field that is already returned changes nothing', () => {
    const base = none();
    expect(on(base, 'a')).toBe(base);
  });

  it('unchecking _id writes _id: 0', () => {
    expect(sent(off(none(), '_id'))).toEqual({ _id: 0 });
  });

  it('a $slice-only projection keeps its entry and gains the exclusion', () => {
    const next = off(raw('{"tags":{"$slice":3}}'), 'b');
    expect(sent(next)).toEqual({ b: 0, tags: '{"$slice":3}' });
    expect(projectionMode(next)).toMatchObject({ mode: 'exclusion', locked: ['tags'] });
  });

  it('a $slice row is locked', () => {
    const base = raw('{"tags":{"$slice":3}}');
    expect(off(base, 'tags')).toBe(base);
    expect(on(base, 'tags')).toBe(base);
  });
});

describe('toggleProjectionField — an inclusion', () => {
  it('checking adds the field, in the list order, as the modelled list', () => {
    expect(on(inc('a', 'c'), 'b')).toEqual({ projection: ['a', 'b', 'c'], projectionRaw: undefined, sort: '', limit: '' });
  });

  it('unchecking removes it', () => {
    expect(off(inc('a', 'b', 'c'), 'b').projection).toEqual(['a', 'c']);
  });

  it('removes the last field as {_id: 1}, never as "everything"', () => {
    const next = off(inc('a'), 'a');
    expect(next.projection).toEqual(['_id']);
    expect(projectionMode(next).mode).toBe('inclusion');
  });

  it('writes a $slice beside plain 1s as a raw projection', () => {
    const next = on(raw('{"a":1,"t":{"$slice":2}}'), 'b');
    expect(next.projection).toEqual([]);
    expect(sent(next)).toEqual({ a: 1, b: 1, t: '{"$slice":2}' });
  });

  it('checking another row adds field: 1 beside an operator', () => {
    const next = on(raw('{"c":{"$elemMatch":{"x":1}}}'), 'a');
    expect(sent(next)).toEqual({ a: 1, c: '{"$elemMatch":{"x":1}}' });
  });

  it('a locked operator row does nothing in either direction', () => {
    const base = raw('{"a":1,"c":{"$elemMatch":{"x":1}}}');
    expect(off(base, 'c')).toBe(base);
    expect(on(base, 'c')).toBe(base);
  });

  it('removing the last plain field beside a $slice leaves {_id: 1} and the slice', () => {
    const next = off(raw('{"a":1,"t":{"$slice":2}}'), 'a');
    expect(sent(next)).toEqual({ _id: 1, t: '{"$slice":2}' });
    expect(projectionMode(next).mode).toBe('inclusion');
  });

  describe('_id', () => {
    it('unchecking _id writes _id: 0 beside the inclusion', () => {
      const next = off(inc('a'), '_id');
      expect(sent(next)).toEqual({ a: 1, _id: 0 });
      expect(projectionMode(next).mode).toBe('inclusion');
    });

    it('checking _id removes an _id: 0, back to the modelled list', () => {
      const next = on(raw('{"a":1,"_id":0}'), '_id');
      expect(next).toEqual({ projection: ['a'], projectionRaw: undefined, sort: '', limit: '' });
    });

    it('an explicit _id: 1 is unchecked to _id: 0', () => {
      expect(sent(off(inc('_id', 'a'), '_id'))).toEqual({ a: 1, _id: 0 });
    });

    it('leaves the builder alone when unchecking would leave nothing to return', () => {
      const base = raw('{"a":1,"_id":0}');
      expect(off(base, 'a')).toBe(base);
      const onlyId = inc('_id');
      expect(off(onlyId, '_id')).toBe(onlyId);
    });

    it('checking a field the inclusion holds as a stray 0 turns it into a 1', () => {
      expect(sent(on(raw('{"a":1,"b":0}'), 'b'))).toEqual({ a: 1, b: 1 });
    });
  });
});

describe('toggleProjectionField — an exclusion', () => {
  it('unchecking adds field: 0, in the list order', () => {
    expect(sent(off(raw('{"c":0}'), 'a'))).toEqual({ a: 0, c: 0 });
    expect(Object.keys(sent(off(raw('{"c":0}'), 'a')))).toEqual(['a', 'c']);
    expect(Object.keys(sent(off(raw('{"a":0}'), 'c')))).toEqual(['a', 'c']);
  });

  it('checking removes the field', () => {
    expect(sent(on(raw('{"a":0,"c":0}'), 'a'))).toEqual({ c: 0 });
  });

  it('removing the last exclusion clears the projection to exactly "no projection"', () => {
    expect(on(raw('{"a":0}'), 'a')).toEqual({ projection: [], projectionRaw: undefined, sort: '', limit: '' });
    expect(Object.hasOwn(on(raw('{"a":0}'), 'a'), 'projectionRaw')).toBe(true);
    expect(projectionMode(on(raw('{"a":0}'), 'a')).mode).toBe('none');
  });

  it('unchecking a field already excluded changes nothing', () => {
    expect(sent(off(raw('{"a":0}'), 'a'))).toEqual({ a: 0 });
  });

  it('checking a field that is not excluded changes nothing', () => {
    const base = raw('{"a":0}');
    expect(sent(on(base, 'b'))).toEqual({ a: 0 });
  });

  it('removing the last exclusion beside a $slice leaves the slice', () => {
    const next = on(raw('{"a":0,"t":{"$slice":2}}'), 'a');
    expect(sent(next)).toEqual({ t: '{"$slice":2}' });
    expect(projectionMode(next).mode).toBe('none');
  });

  it('removing the last exclusion drops the 1 that rode along, which would flip the mode', () => {
    const next = on(raw('{"_id":1,"a":0}'), 'a');
    expect(next).toEqual({ projection: [], projectionRaw: undefined, sort: '', limit: '' });
  });

  it('checking _id removes _id: 0', () => {
    expect(sent(on(raw('{"_id":0,"a":0}'), '_id'))).toEqual({ a: 0 });
  });

  it('unchecking _id adds _id: 0', () => {
    expect(sent(off(raw('{"a":0}'), '_id'))).toEqual({ _id: 0, a: 0 });
  });

  it('a locked operator row is untouched and another uncheck sits beside it', () => {
    const base = raw('{"a":0,"t":{"$slice":2}}');
    expect(off(base, 't')).toBe(base);
    expect(sent(off(base, 'b'))).toEqual({ a: 0, b: 0, t: '{"$slice":2}' });
  });

  it('a dotted exclusion is written as its own entry', () => {
    expect(sent(off(none(), 'address.city'))).toEqual({ 'address.city': 0 });
  });

  it('keeps an entry the list does not know in the place it had', () => {
    const next = off(raw('{"x":0,"y":0}'), 'a', ['a']);
    expect(Object.keys(sent(next))).toEqual(['a', 'x', 'y']);
  });
});

describe('toggleProjectionField — path collision', () => {
  it('a dotted child of an included parent is a column only, never written beside it', () => {
    const base = inc('address');
    expect(on(base, 'address.city')).toBe(base);
  });

  it('a dotted child of a parent that carries an operator is not written beside it either', () => {
    const base = raw('{"address":{"$slice":2},"b":1}');
    expect(on(base, 'address.city')).toBe(base);
  });

  it('checking the parent replaces the dotted children it now covers', () => {
    const next = on(inc('a.x', 'a.y', 'b'), 'a', ['a', 'b']);
    expect(sent(next)).toEqual({ a: 1, b: 1 });
    expect(next.projection).toEqual(['a', 'b']);
  });

  it('a dotted sibling with a shared prefix is not a child', () => {
    expect(sent(on(inc('ab'), 'a.x'))).toEqual({ ab: 1, 'a.x': 1 });
    expect(sent(on(inc('a.x'), 'a'))).toEqual({ a: 1 });
    expect(sent(on(inc('ab.x'), 'a'))).toEqual({ 'ab.x': 1, a: 1 });
  });

  it('a dotted path under an inclusion is written as its own entry when no parent is named', () => {
    expect(sent(on(inc('name'), 'address.city', ['name', 'address.city']))).toEqual({
      name: 1,
      'address.city': 1,
    });
  });

  it('unchecking the parent takes the dotted children with it', () => {
    expect(sent(off(inc('a', 'b'), 'a', ['a', 'b']))).toEqual({ b: 1 });
    expect(sent(off(inc('a.x', 'b'), 'a', ['a', 'b']))).toEqual({ b: 1 });
  });

  it('unchecking a dotted child whose parent is included cannot be written, so nothing changes', () => {
    const base = inc('a', 'b');
    expect(off(base, 'a.x')).toBe(base);
  });

  it('an excluded parent already drops its dotted children', () => {
    const base = raw('{"a":0}');
    expect(off(base, 'a.x')).toBe(base);
  });

  it('excluding the parent replaces the dotted exclusions under it', () => {
    expect(sent(off(raw('{"a.x":0,"a.y":0,"b":0}'), 'a', ['a', 'b']))).toEqual({ a: 0, b: 0 });
  });

  it('a dotted path under a $slice parent is not written beside it, since MongoDB refuses the path collision', () => {
    const base = raw('{"a":{"$slice":2}}');
    expect(off(base, 'a.x')).toBe(base);
  });
});

describe('toggleProjectionField — an unreadable projection', () => {
  it('is returned untouched, so the list never overwrites what the user is typing', () => {
    const base = raw('{"a":');
    expect(off(base, 'b')).toBe(base);
    expect(on(base, 'b')).toBe(base);
  });
});

describe('onlyRemovesFields', () => {
  it('an inclusion that shrinks but stays non-empty', () => {
    expect(onlyRemovesFields(inc('a', 'b'), inc('a'))).toBe(true);
  });
  it('an inclusion that grows or swaps a field', () => {
    expect(onlyRemovesFields(inc('a'), inc('a', 'b'))).toBe(false);
    expect(onlyRemovesFields(inc('a', 'b'), inc('a', 'c'))).toBe(false);
  });
  it('an unchanged projection', () => {
    expect(onlyRemovesFields(inc('a'), inc('a'))).toBe(true);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":0}'))).toBe(true);
    expect(onlyRemovesFields(none(), none())).toBe(true);
  });
  it('an exclusion that grows', () => {
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":0,"b":0}'))).toBe(true);
  });
  it('an exclusion that shrinks', () => {
    expect(onlyRemovesFields(raw('{"a":0,"b":0}'), raw('{"a":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"b":0}'))).toBe(false);
  });
  it('none to an exclusion', () => {
    expect(onlyRemovesFields(none(), raw('{"a":0}'))).toBe(true);
  });
  it('an exclusion back to none, and any mode flip', () => {
    expect(onlyRemovesFields(raw('{"a":0}'), none())).toBe(false);
    expect(onlyRemovesFields(none(), inc('a'))).toBe(false);
    expect(onlyRemovesFields(inc('a'), none())).toBe(false);
    expect(onlyRemovesFields(inc('a'), raw('{"a":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), inc('a'))).toBe(false);
  });
  it('an operator that is added, removed or changed', () => {
    const slice = (n: number) => raw(`{"a":0,"t":{"$slice":${n}}}`);
    expect(onlyRemovesFields(raw('{"a":0}'), slice(2))).toBe(false);
    expect(onlyRemovesFields(slice(2), raw('{"a":0}'))).toBe(false);
    expect(onlyRemovesFields(slice(2), slice(3))).toBe(false);
    expect(onlyRemovesFields(slice(2), slice(2))).toBe(true);
    expect(onlyRemovesFields(slice(2), { ...slice(2), projectionRaw: '{"t":{"$slice":2},"a":0}' })).toBe(true);
  });
  it('an operator on a different field with the same value is a change', () => {
    expect(
      onlyRemovesFields(raw('{"a":0,"t":{"$slice":2}}'), raw('{"a":0,"u":{"$slice":2}}')),
    ).toBe(false);
  });
  it('an unreadable projection on either side', () => {
    expect(onlyRemovesFields(raw('{"a":'), raw('{"a":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":'))).toBe(false);
  });
  it('_id: an inclusion that stops returning _id shrinks, one that starts does not', () => {
    expect(onlyRemovesFields(inc('a'), raw('{"a":1,"_id":0}'))).toBe(true);
    expect(onlyRemovesFields(raw('{"a":1,"_id":0}'), inc('a'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":1,"_id":0}'), raw('{"a":1,"_id":1}'))).toBe(false);
  });
  it('a newly dropped dotted path never keeps the rows current, since no view hides it', () => {
    expect(onlyRemovesFields(none(), raw('{"address.city":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":0,"b.c":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":0,"b":0}'))).toBe(true);
    expect(onlyRemovesFields(inc('a.b', 'c'), inc('c'))).toBe(false);
    expect(onlyRemovesFields(inc('a.b', 'c'), inc('a.b'))).toBe(true);
  });

  it('unchecking the last field of an inclusion keeps the rows: _id came back unnamed before', () => {
    expect(onlyRemovesFields(inc('a'), inc('_id'))).toBe(true);
    expect(onlyRemovesFields(raw('{"a":1,"_id":0}'), inc('_id'))).toBe(false);
  });

  it('a dotted path is covered by its parent', () => {
    // Narrowing to a dotted path leaves the rest of `a` drawn: the views hide
    // whole top-level fields only, so the rows can no longer read as current.
    expect(onlyRemovesFields(inc('a'), inc('a.b'))).toBe(false);
    expect(onlyRemovesFields(inc('a.b'), inc('a'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a.b":0}'), raw('{"a":0}'))).toBe(true);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a.b":0}'))).toBe(false);
  });
});

function tab(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Table',
    builder: none(),
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [{ _id: 1, a: 1, b: 2 }], durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
    ...over,
  };
}

// A tab whose rows came from the query it holds now.
function ranTab(over: Partial<CollectionTabState> = {}): CollectionTabState {
  const t = tab(over);
  return { ...t, lastRunQueryKey: resultQueryKey(t)! };
}

describe('projectionPatch', () => {
  it('moves the rows\' key with a change that only removes fields, so the rows stay current', () => {
    const prev = ranTab();
    const patch = projectionPatch(prev, off(prev.builder, 'a'));
    expect(patch.builder?.projectionRaw).toBe('{"a":0}');
    expect(patch.lastRunQueryKey).toBe(resultQueryKey({ ...prev, builder: patch.builder! }));
    expect(patch.lastRunQueryKey).not.toBe(prev.lastRunQueryKey);
    expect(isResultStale({ ...prev, ...patch })).toBe(false);
  });

  it('leaves the key alone for a change that adds a field, so the strip appears', () => {
    const prev = ranTab({ builder: raw('{"a":0}') });
    const patch = projectionPatch(prev, on(prev.builder, 'a'));
    expect(patch).toEqual({ builder: patch.builder });
    expect(isResultStale({ ...prev, ...patch })).toBe(true);
  });

  it('keeps stale rows stale: a filter edited, then a column unchecked', () => {
    const ran = ranTab();
    const edited = { ...ran, queryRaw: '{"a":1}' };
    expect(isResultStale(edited)).toBe(true);
    const patch = projectionPatch(edited, off(edited.builder, 'b'));
    expect(patch.lastRunQueryKey).toBeUndefined();
    expect(Object.hasOwn(patch, 'lastRunQueryKey')).toBe(false);
    expect(isResultStale({ ...edited, ...patch })).toBe(true);
  });

  it('keeps stale rows stale when the projection itself was edited first', () => {
    const ran = ranTab({ builder: raw('{"a":0}') });
    const edited = { ...ran, builder: raw('{"a":0,"b":0}') };
    expect(isResultStale(edited)).toBe(true);
    const patch = projectionPatch(edited, off(edited.builder, 'c'));
    expect(Object.hasOwn(patch, 'lastRunQueryKey')).toBe(false);
    expect(isResultStale({ ...edited, ...patch })).toBe(true);
  });

  it('writes no key for a tab that has never run', () => {
    const prev = tab();
    const patch = projectionPatch(prev, off(prev.builder, 'a'));
    expect(Object.hasOwn(patch, 'lastRunQueryKey')).toBe(false);
  });

  it('a change that does nothing patches the same builder and key', () => {
    const prev = ranTab({ builder: raw('{"a":0}') });
    const patch = projectionPatch(prev, off(prev.builder, 'a'));
    expect(patch.lastRunQueryKey).toBe(prev.lastRunQueryKey);
  });

  it('a mode flip raises the strip even from current rows', () => {
    const prev = ranTab({ builder: raw('{"a":0}') });
    const patch = projectionPatch(prev, none());
    expect(Object.hasOwn(patch, 'lastRunQueryKey')).toBe(false);
    expect(isResultStale({ ...prev, ...patch })).toBe(true);
  });
});

describe('migrateHiddenColumns', () => {
  it('a hidden field with its own operator is excluded, dropping the operator that shaped nothing shown', () => {
    const prev = ranTab({ builder: raw('{"tags":{"$slice":2}}'), columnConfig: { hidden: ['tags'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projectionRaw).toBe('{"tags":0}');
    expect(next.columnConfig).toEqual({});
  });

  it('a hidden field with an operator inside it is excluded, dropping that operator', () => {
    const prev = ranTab({ builder: raw('{"address.items":{"$slice":2},"notes":0}'), columnConfig: { hidden: ['address'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projectionRaw).toBe('{"address":0,"notes":0}');
    expect(next.columnConfig).toEqual({});
  });

  it('a hidden field with an operator under an inclusion is removed with it', () => {
    const prev = ranTab({ builder: raw('{"name":1,"tags":{"$elemMatch":{"x":1}}}'), columnConfig: { hidden: ['tags'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projection).toEqual(['name']);
    expect(next.builder.projectionRaw).toBeUndefined();
    expect(next.columnConfig?.hidden).toBeUndefined();
  });

  it('an inclusion whose only field is a hidden operator stays an inclusion, of _id alone', () => {
    const prev = ranTab({ builder: raw('{"tags":{"$elemMatch":{"x":1}}}'), columnConfig: { hidden: ['tags'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projection).toEqual(['_id']);
    expect(next.builder.projectionRaw).toBeUndefined();
    expect(next.columnConfig?.hidden).toBeUndefined();
  });

  it('an inclusion of only a hidden operator beside _id: 0 is left as it was, the field still hidden', () => {
    const prev = ranTab({ builder: raw('{"_id":0,"tags":{"$elemMatch":{"x":1}}}'), columnConfig: { hidden: ['tags'] } });
    expect(migrateHiddenColumns(prev)).toBe(prev);
  });

  it('keeps a hidden name it cannot write, rather than show a field the user hid', () => {
    const prev = ranTab({ builder: raw('{"a":{"$slice":2}}'), columnConfig: { hidden: ['a.x'] } });
    expect(migrateHiddenColumns(prev)).toBe(prev);
  });

  it('keeps only the names it could not write when others migrate', () => {
    const prev = ranTab({ builder: raw('{"a":{"$slice":2}}'), columnConfig: { hidden: ['a.x', 'b'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projectionRaw).toBe('{"b":0,"a":{"$slice":2}}');
    expect(next.columnConfig?.hidden).toEqual(['a.x']);
    expect(migrateHiddenColumns(next)).toBe(next);
  });

  it('hidden only: becomes the equivalent exclusion, the rows stay current', () => {
    const prev = ranTab({ columnConfig: { hidden: ['b', 'a'], order: ['a', 'b'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projectionRaw).toBe('{"b":0,"a":0}');
    expect(next.builder.projection).toEqual([]);
    expect(next.columnConfig).toEqual({ order: ['a', 'b'] });
    expect(Object.hasOwn(next.columnConfig!, 'hidden')).toBe(false);
    expect(isResultStale(prev)).toBe(false);
    expect(isResultStale(next)).toBe(false);
    expect(next.lastRunQueryKey).toBe(resultQueryKey(next));
  });

  it('hidden with an inclusion: each hidden field the projection returns is removed', () => {
    const prev = ranTab({ builder: inc('a', 'b', 'c'), columnConfig: { hidden: ['b', 'zzz'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projection).toEqual(['a', 'c']);
    // Result documents are not kept, so the removed field would have no row
    // left in the Fields list: the order remembers it, with the hidden names.
    expect(next.columnConfig).toEqual({ order: ['a', 'b', 'c', 'zzz'] });
    expect(isResultStale(next)).toBe(false);
  });

  it('hidden with an inclusion and no order: the removed field stays listed', () => {
    const next = migrateHiddenColumns(ranTab({ builder: inc('a', 'b'), columnConfig: { hidden: ['b'] } }));
    expect(next.builder.projection).toEqual(['a']);
    expect(next.columnConfig).toEqual({ order: ['a', 'b'] });
    expect(Object.hasOwn(next.columnConfig!, 'hidden')).toBe(false);
  });

  it('hidden with an inclusion keeps the order the tab had and the dotted columns it keeps', () => {
    const next = migrateHiddenColumns(
      ranTab({
        builder: inc('a', 'b'),
        columnConfig: { hidden: ['b'], order: ['b', 'x'], computed: [{ id: 'c1', path: 'p.q' }] },
      }),
    );
    expect(next.columnConfig?.order).toEqual(['b', 'x', 'a', 'p.q']);
    expect(next.columnConfig?.computed).toEqual([{ id: 'c1', path: 'p.q' }]);
  });

  it('hidden with an inclusion whose order already names everything leaves the order alone', () => {
    const next = migrateHiddenColumns(
      ranTab({ builder: inc('a', 'b'), columnConfig: { hidden: ['b'], order: ['b', 'a'] } }),
    );
    expect(next.columnConfig).toEqual({ order: ['b', 'a'] });
  });

  it('hidden with an inclusion that already lacks the field removes nothing and writes no order', () => {
    const next = migrateHiddenColumns(ranTab({ builder: inc('a'), columnConfig: { hidden: ['zzz'] } }));
    expect(next.builder.projection).toEqual(['a']);
    expect(next.columnConfig).toEqual({});
  });

  it('hidden with an exclusion: each hidden field is added to it', () => {
    const prev = ranTab({ builder: raw('{"c":0}'), columnConfig: { hidden: ['a'] } });
    const next = migrateHiddenColumns(prev);
    expect(sent(next.builder)).toEqual({ a: 0, c: 0 });
    // An exclusion keeps every name it drops, so nothing needs remembering.
    expect(next.columnConfig).toEqual({});
    expect(isResultStale(next)).toBe(false);
  });

  it('hidden with a projection that already drops it changes the projection not at all', () => {
    const prev = ranTab({ builder: raw('{"a":0}'), columnConfig: { hidden: ['a'] } });
    const next = migrateHiddenColumns(prev);
    expect(sent(next.builder)).toEqual({ a: 0 });
    expect(next.columnConfig).toEqual({});
  });

  it('a stale tab stays stale', () => {
    const prev = { ...ranTab({ columnConfig: { hidden: ['a'] } }), queryRaw: '{"x":1}' };
    const next = migrateHiddenColumns(prev);
    expect(isResultStale(next)).toBe(true);
    expect(next.lastRunQueryKey).toBe(prev.lastRunQueryKey);
  });

  it('a tab that never ran gets the builder and no key', () => {
    const prev = tab({ columnConfig: { hidden: ['a'] } });
    const next = migrateHiddenColumns(prev);
    expect(next.builder.projectionRaw).toBe('{"a":0}');
    expect(next.lastRunQueryKey).toBeUndefined();
  });

  it('empty hidden, no hidden and no column config are all left as they are', () => {
    const empty = ranTab({ columnConfig: { hidden: [] } });
    expect(migrateHiddenColumns(empty)).toBe(empty);
    const noHidden = ranTab({ columnConfig: { order: ['a'] } });
    expect(migrateHiddenColumns(noHidden)).toBe(noHidden);
    const bare = ranTab();
    expect(migrateHiddenColumns(bare)).toBe(bare);
    expect(isResultStale(migrateHiddenColumns(empty))).toBe(false);
  });

  it('is idempotent for an inclusion too', () => {
    const once = migrateHiddenColumns(ranTab({ builder: inc('a', 'b'), columnConfig: { hidden: ['b'] } }));
    expect(migrateHiddenColumns(once)).toBe(once);
  });

  it('is idempotent', () => {
    const once = migrateHiddenColumns(ranTab({ columnConfig: { hidden: ['a', 'b'] } }));
    expect(migrateHiddenColumns(once)).toBe(once);
  });

  it('leaves a hidden list beside an unreadable projection for when it parses again', () => {
    const prev = tab({ builder: raw('{"a":'), columnConfig: { hidden: ['b'] } });
    expect(migrateHiddenColumns(prev)).toBe(prev);
  });
});

describe('migrateHiddenSeed', () => {
  it('returns the seed itself when it holds no hidden list', () => {
    const seed = { pageSize: 25 };
    expect(migrateHiddenSeed(seed)).toBe(seed);
    const empty = { columnConfig: { hidden: [] } };
    expect(migrateHiddenSeed(empty)).toBe(empty);
  });

  it('reads the missing parts as a new tab\'s defaults and keeps what the seed said', () => {
    const next = migrateHiddenSeed({ pageSize: 25, columnConfig: { hidden: ['a'], order: ['b', 'a'] } });
    expect(next.pageSize).toBe(25);
    expect(next.builder?.projectionRaw).toBe('{"a":0}');
    expect(next.columnConfig).toEqual({ order: ['b', 'a'] });
    expect(Object.hasOwn(next, 'lastRunQueryKey')).toBe(false);
  });

  it('carries the remembered order for an inclusion seed', () => {
    const next = migrateHiddenSeed({ builder: inc('a', 'b'), columnConfig: { hidden: ['b'] } });
    expect(next.builder?.projection).toEqual(['a']);
    expect(next.columnConfig).toEqual({ order: ['a', 'b'] });
  });

  it('carries a key the seed had, current for the new builder', () => {
    const base = ranTab({ columnConfig: { hidden: ['a'] } });
    const next = migrateHiddenSeed(base);
    expect(next.lastRunQueryKey).toBe(resultQueryKey({ ...base, builder: next.builder! }));
  });

  it('migrationPatch names only what the migration can change', () => {
    const migrated = migrateHiddenColumns(ranTab({ columnConfig: { hidden: ['a'] } }));
    expect(Object.keys(migrationPatch(migrated)).sort((x, y) => x.localeCompare(y))).toEqual([
      'builder',
      'columnConfig',
      'lastRunQueryKey',
    ]);
    expect(Object.keys(migrationPatch(migrateHiddenColumns(tab({ columnConfig: { hidden: ['a'] } }))))).toEqual([
      'builder',
      'columnConfig',
    ]);
  });
});

// Each case below pins a branch of the writer that the broader suites above
// reach only through a result they would see either way.
describe('toggleProjectionField — clicks that change nothing hand back the same builder', () => {
  it('checking a field an exclusion does not name leaves the exclusion alone', () => {
    const b = raw('{"b":0,"c":0}');
    expect(on(b, 'a')).toBe(b);
  });

  it('unchecking a field an exclusion already names, however it spells the zero', () => {
    const b = raw('{"a":0}');
    expect(off(b, 'a')).toBe(b);
    const spelled = raw('{"a":false}');
    expect(off(spelled, 'a')).toBe(spelled);
  });

  it('checking an inclusion\'s _id that is already returned', () => {
    const b = inc('_id', 'a');
    expect(on(b, '_id')).toBe(b);
  });
});

describe('toggleProjectionField — what rides along an exclusion', () => {
  it('keeps a 1 beside the exclusions that remain when a field is checked', () => {
    const next = on(raw('{"x":0,"y":0,"_id":1}'), 'x');
    expect(sent(next)).toEqual({ y: 0, _id: 1 });
  });

  it('drops the 1 once no exclusion is left, rather than turning the projection into an inclusion', () => {
    const next = on(raw('{"x":0,"_id":1}'), 'x');
    expect(next.projectionRaw).toBeUndefined();
    expect(next.projection).toEqual([]);
  });

  it('unchecking an _id held as a 1 beside exclusions turns that entry into a 0', () => {
    const next = off(raw('{"x":0,"_id":1}'), '_id');
    expect(sent(next)).toEqual({ x: 0, _id: 0 });
  });
});

describe('toggleProjectionField — an inclusion drops what the field covered', () => {
  it('unchecking a parent takes its dotted children with it', () => {
    expect(off(inc('a', 'a.b', 'c'), 'a').projection).toEqual(['c']);
  });
});

describe('onlyRemovesFields — fine print', () => {
  it('a dotted key is covered by each of its ancestors, not by the characters of its name', () => {
    expect(onlyRemovesFields(inc('a.b'), inc('a.b.c'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a.b.c":0}'), raw('{"a.b":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a.b.c":0}'), raw('{"a":0}'))).toBe(true);
    expect(onlyRemovesFields(inc('a.b'), inc('a.c'))).toBe(false);
  });

  it('an explicit _id: 0 on both sides keeps the rows, since neither fetches _id', () => {
    expect(onlyRemovesFields(raw('{"a":1,"_id":0}'), raw('{"a":1,"_id":0}'))).toBe(true);
  });

  it('a 1 on _id is not an exclusion of it', () => {
    expect(onlyRemovesFields(raw('{"a":1,"_id":0}'), raw('{"a":1,"_id":1}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":1,"_id":1}'), raw('{"a":1,"_id":0}'))).toBe(true);
  });

  it('a 1 on _id counts as fetching it, in an inclusion and beside exclusions', () => {
    expect(onlyRemovesFields(raw('{"a":1,"_id":1}'), inc('a'))).toBe(true);
    expect(onlyRemovesFields(raw('{"x":0,"_id":1}'), raw('{"x":0,"y":0}'))).toBe(true);
  });

  it('an exclusion never turns into an inclusion that happens to exclude the same key', () => {
    expect(onlyRemovesFields(raw('{"_id":0}'), raw('{"a":1,"_id":0}'))).toBe(false);
  });

  it('operator rows compare by key and value, not by which plain fields surround them or their order', () => {
    const slices = (first: 'z' | 'y') =>
      first === 'z'
        ? '{"x":0,"z":{"$slice":1},"y":{"$slice":2}}'
        : '{"x":0,"y":{"$slice":2},"z":{"$slice":1}}';
    expect(onlyRemovesFields(raw(slices('z')), raw(slices('y')))).toBe(true);
    expect(
      onlyRemovesFields(raw('{"b":0,"s":{"$slice":3}}'), raw('{"b":0,"c":0,"s":{"$slice":3}}')),
    ).toBe(true);
  });

  it('an unreadable next projection never keeps the rows, whatever the one before it was', () => {
    expect(onlyRemovesFields(none(), raw('{"a":'))).toBe(false);
    expect(onlyRemovesFields(inc('a'), raw('{"a":'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":0}'), raw('{"a":'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":'), raw('{"a":0}'))).toBe(false);
    expect(onlyRemovesFields(raw('{"a":'), none())).toBe(false);
  });
});

describe('migrateHiddenSeed — fine print', () => {
  it('a seed whose column config has no hidden list is returned as it came', () => {
    const seed = { columnConfig: { order: ['a'] } };
    expect(migrateHiddenSeed(seed)).toBe(seed);
  });

  it('a hidden list beside an unreadable projection is left alone, the seed itself coming back', () => {
    const seed = { builder: raw('{"a":'), columnConfig: { hidden: ['a'] } };
    expect(migrateHiddenSeed(seed)).toBe(seed);
  });
});

describe('toggleProjectionField beside an operator row', () => {
  it('leaves a parent of an operator path alone, rather than write a path collision or drop the operator', () => {
    const b = raw('{"address.items":{"$slice":2}}');
    expect(toggleProjectionField(b, 'address', false, [])).toBe(b);
    expect(toggleProjectionField(b, 'address', true, [])).toBe(b);
    const inc = raw('{"address.items":{"$slice":2},"name":1}');
    expect(toggleProjectionField(inc, 'address', true, [])).toBe(inc);
    expect(toggleProjectionField(inc, 'address', false, [])).toBe(inc);
  });

  it('leaves a child of an operator path alone', () => {
    const b = raw('{"tags":{"$elemMatch":{"x":1}}}');
    expect(toggleProjectionField(b, 'tags.x', true, [])).toBe(b);
  });

  it('still toggles an unrelated field beside the operator', () => {
    const b = raw('{"address.items":{"$slice":2}}');
    expect(toggleProjectionField(b, 'notes', false, []).projectionRaw).toBe('{"address.items":{"$slice":2},"notes":0}');
  });
});

describe('a leftover hidden list beside the projection', () => {
  it('projectionHider hides a leftover name and still what the projection drops', () => {
    const hide = projectionHider(raw('{"notes":0}'), ['tags'])!;
    expect(hide('tags')).toBe(true);
    expect(hide('notes')).toBe(true);
    expect(hide('name')).toBe(false);
  });

  it('projectionHider with no projection hides only the leftover names', () => {
    const hide = projectionHider(none(), ['tags'])!;
    expect(hide('tags')).toBe(true);
    expect(hide('name')).toBe(false);
    expect(projectionHider(none(), [])).toBeNull();
  });

  it('projectedOutFields adds a leftover name the columns know, once', () => {
    expect(projectedOutFields(raw('{"notes":0}'), ['_id', 'notes', 'tags'], ['tags', 'notes', 'zzz'])).toEqual([
      'notes',
      'tags',
    ]);
    expect(projectedOutFields(undefined, ['tags'], ['tags'])).toEqual(['tags']);
  });
});

describe('redactHidden', () => {
  it('keeps an own __proto__ field the projection retains', () => {
    // Built from JSON so `__proto__` is an own property, not the prototype.
    const doc = JSON.parse('{"__proto__":{"x":1},"a":2,"b":3}') as Record<string, unknown>;
    const out = redactHidden(doc, (k) => k === 'b') as Record<string, unknown>;
    expect(Object.keys(out)).toEqual(['__proto__', 'a']);
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
  });

  it('drops the hidden top-level fields from a copy and leaves the document alone', () => {
    const doc = { _id: 1, a: 'x', b: 'y' };
    expect(redactHidden(doc, (k) => k === 'a')).toEqual({ _id: 1, b: 'y' });
    expect(doc).toEqual({ _id: 1, a: 'x', b: 'y' });
  });

  it('hands back the very same value when nothing is hidden or the value is not a document', () => {
    const doc = { a: 1 };
    expect(redactHidden(doc, null)).toBe(doc);
    expect(redactHidden('text', (k) => k === 'a')).toBe('text');
    expect(redactHidden(null, (k) => k === 'a')).toBeNull();
    const list = [1];
    expect(redactHidden(list, (k) => k === '0')).toBe(list);
  });
});

// A result page can hold more than the 50 documents the column list samples,
// so what the views hide must not depend on that sample.
describe('projectionHider', () => {
  const hides = (b: BuilderState, ...keys: string[]) => keys.map((k) => projectionHider(b)!(k));

  it('is null when the projection keeps nothing off the wire', () => {
    expect(projectionHider(undefined)).toBeNull();
    expect(projectionHider(none())).toBeNull();
    expect(projectionHider(raw('{"a":'))).toBeNull();
    expect(projectionHider(raw('{"tags":{"$slice":3}}'))).toBeNull();
  });

  it('hides an explicitly excluded top-level name whether or not any document holds it', () => {
    expect(hides(raw('{"a":0,"late":0}'), 'a', 'late', 'b')).toEqual([true, true, false]);
  });

  it('a dotted exclusion never hides the parent field', () => {
    expect(projectionHider(raw('{"a.b":0}'))).toBeNull();
    expect(hides(raw('{"a.b":0,"c":0}'), 'a', 'a.b', 'c')).toEqual([false, false, true]);
  });

  it('under an inclusion hides every key it does not fetch, keeping _id unless excluded', () => {
    expect(hides(inc('a', 'b.c'), '_id', 'a', 'b', 'zzz')).toEqual([false, false, false, true]);
    expect(hides(raw('{"a":1,"_id":0}'), '_id', 'a')).toEqual([true, false]);
    expect(hides(raw('{"a":1,"t":{"$slice":2}}'), 't', 'a', 'zzz')).toEqual([false, false, true]);
  });
});

describe('hiddenFieldNames', () => {
  it('names each hidden key once, scanning every document and not a sample', () => {
    const docs = Array.from({ length: 60 }, (_, i) => (i === 55 ? { _id: i, a: 1, late: 2 } : { _id: i, a: 1 }));
    expect(hiddenFieldNames(docs, projectionHider(inc('a')))).toEqual(['late']);
    expect(hiddenFieldNames(docs, projectionHider(raw('{"late":0}')))).toEqual(['late']);
    expect(hiddenFieldNames(docs, null)).toEqual([]);
    expect(hiddenFieldNames([...docs, 'text', null], projectionHider(inc('a')))).toEqual(['late']);
  });
});

describe('projectionPathHider', () => {
  const drops = (b: BuilderState, ...paths: string[]) => paths.map((p) => projectionPathHider(b)!(p));

  it('is null for no projection, an unreadable one or a $slice-only trim', () => {
    expect(projectionPathHider(undefined)).toBeNull();
    expect(projectionPathHider(none())).toBeNull();
    expect(projectionPathHider(raw('{"a":'))).toBeNull();
  });

  it('an exclusion drops the path itself and everything under it', () => {
    expect(drops(raw('{"address":0}'), 'address', 'address.city', 'address.geo.lat', 'name')).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(drops(raw('{"address.city":0}'), 'address', 'address.city', 'address.zip')).toEqual([false, true, false]);
  });

  it('an inclusion drops what no kept entry covers, from either side', () => {
    expect(drops(inc('name', 'address'), 'name', 'address.city', 'tags.0', '_id')).toEqual([false, false, true, false]);
    // `address` is only partly returned, so its column still has something to show.
    expect(drops(inc('address.city'), 'address', 'address.city', 'address.zip')).toEqual([false, false, true]);
    expect(drops(raw('{"a":1,"_id":0}'), '_id', '_id.x')).toEqual([true, true]);
    // A stray zero beside an inclusion is not something the inclusion honours.
    expect(drops(raw('{"a":1,"b":0}'), 'b')).toEqual([true]);
  });
});
