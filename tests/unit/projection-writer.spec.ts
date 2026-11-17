import { describe, it, expect } from 'vitest';
import {
  migrateHiddenColumns,
  migrateHiddenSeed,
  migrationPatch,
  onlyRemovesFields,
  projectionPatch,
  toggleProjectionField,
} from '../../src/pages/Workspace/projectionWriter';
import { projectedOutFields, projectionMode } from '../../src/pages/Workspace/projection';
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
  it('a dotted path is covered by its parent', () => {
    expect(onlyRemovesFields(inc('a'), inc('a.b'))).toBe(true);
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
    expect(next.columnConfig).toEqual({});
    expect(isResultStale(next)).toBe(false);
  });

  it('hidden with an exclusion: each hidden field is added to it', () => {
    const prev = ranTab({ builder: raw('{"c":0}'), columnConfig: { hidden: ['a'] } });
    const next = migrateHiddenColumns(prev);
    expect(sent(next.builder)).toEqual({ a: 0, c: 0 });
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
