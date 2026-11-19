import { describe, it, expect } from 'vitest';
import {
  assertPipelineNamespaces,
  assertTargetAllowed,
  cutName,
  filterCollections,
  filterDatabases,
  isDeniedCollection,
  isDeniedDatabase,
  visibleCollections,
  visibleDatabaseNames,
} from '../../electron/agent/namespaceGuard';

const codeOf = (fn: () => void) => {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code;
  }
  return 'did not throw';
};

describe('database and collection rules', () => {
  it.each(['admin', 'local', 'config', 'ADMIN', 'Local', 'cOnFiG'])('denies the database %s', (db) => {
    expect(isDeniedDatabase(db)).toBe(true);
  });

  it.each(['app', 'admin2', 'myadmin', 'configs', 'locals', 'adm', ''])('allows the database %j', (db) => {
    expect(isDeniedDatabase(db)).toBe(false);
  });

  it.each(['system.users', 'system.views', 'system.profile', 'system.', 'system.a.b'])('denies the collection %s', (c) => {
    expect(isDeniedCollection(c)).toBe(true);
  });

  it.each(['system', 'systems.x', 'mysystem.x', 'a.system.b', 'orders', 'System.users'])('allows the collection %s', (c) => {
    expect(isDeniedCollection(c)).toBe(false);
  });
});

describe('assertTargetAllowed', () => {
  it('refuses a denied database or a system collection with NAMESPACE_DENIED', () => {
    expect(codeOf(() => assertTargetAllowed('admin', 'users'))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => assertTargetAllowed('local', 'oplog.rs'))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => assertTargetAllowed('config', 'x'))).toBe('NAMESPACE_DENIED');
    expect(codeOf(() => assertTargetAllowed('app', 'system.profile'))).toBe('NAMESPACE_DENIED');
  });

  it('allows an ordinary target, and a database alone', () => {
    expect(() => assertTargetAllowed('app', 'orders')).not.toThrow();
    expect(() => assertTargetAllowed('app')).not.toThrow();
    expect(codeOf(() => assertTargetAllowed('admin'))).toBe('NAMESPACE_DENIED');
  });
});

describe('assertPipelineNamespaces', () => {
  const lookup = (from: unknown) => ({ $lookup: { from, localField: 'a', foreignField: 'b', as: 'o' } });
  const graph = (from: unknown) => ({ $graphLookup: { from, startWith: '$a', connectFromField: 'a', connectToField: 'b', as: 'o' } });

  it('refuses a system collection as $lookup.from, $graphLookup.from and $unionWith, string or coll', () => {
    for (const stage of [
      lookup('system.users'),
      graph('system.views'),
      { $unionWith: 'system.profile' },
      { $unionWith: { coll: 'system.js', pipeline: [] } },
    ]) {
      expect(codeOf(() => assertPipelineNamespaces([stage]))).toBe('NAMESPACE_DENIED');
    }
  });

  it('refuses the object form of from and coll outright, even for an allowed name', () => {
    for (const stage of [
      lookup({ db: 'app', coll: 'orders' }),
      graph({ db: 'app', coll: 'orders' }),
      { $unionWith: { coll: { db: 'app', coll: 'orders' } } },
      lookup(42),
      lookup(null),
      graph(['orders']),
      { $unionWith: { coll: 7 } },
    ]) {
      expect(codeOf(() => assertPipelineNamespaces([stage]))).toBe('NAMESPACE_DENIED');
    }
  });

  it('accepts ordinary names, and stages that name no source', () => {
    expect(() =>
      assertPipelineNamespaces([
        lookup('orders'),
        graph('tree'),
        { $unionWith: 'archive' },
        { $unionWith: { coll: 'archive', pipeline: [{ $match: {} }] } },
        { $unionWith: { pipeline: [{ $match: {} }] } },
        { $lookup: { pipeline: [{ $match: {} }], as: 'o' } },
        { $match: { from: { db: 'x', coll: 'y' } } },
      ]),
    ).not.toThrow();
  });

  it('refuses a source three levels deep in each nesting form', () => {
    const bad = lookup('system.users');
    const deep = (wrap: (p: unknown[]) => unknown) => [wrap([wrap([wrap([bad])])])];
    const viaFacet = deep((p) => ({ $facet: { a: p } }));
    const viaLookup = deep((p) => ({ $lookup: { from: 'x', as: 'y', pipeline: p } }));
    const viaUnion = deep((p) => ({ $unionWith: { coll: 'x', pipeline: p } }));
    for (const pipeline of [viaFacet, viaLookup, viaUnion]) {
      expect(codeOf(() => assertPipelineNamespaces(pipeline))).toBe('NAMESPACE_DENIED');
    }
  });

  it('refuses a $lookup or $graphLookup body that is not an object, and a $unionWith that is neither a string nor an object', () => {
    for (const stage of [{ $lookup: 'x' }, { $lookup: null }, { $graphLookup: [] }, { $unionWith: 5 }, { $unionWith: null }, { $unionWith: [] }]) {
      expect(codeOf(() => assertPipelineNamespaces([stage]))).toBe('INVALID_INPUT');
    }
    expect(() => assertPipelineNamespaces([{ $lookup: 'x' }])).toThrow('$lookup takes an object.');
    expect(() => assertPipelineNamespaces([{ $graphLookup: 'x' }])).toThrow('$graphLookup takes an object.');
    expect(() => assertPipelineNamespaces([{ $unionWith: 5 }])).toThrow('$unionWith takes a collection name or an object.');
  });

  it('carries the fixed refusal message, with no name in it', () => {
    expect(() => assertPipelineNamespaces([lookup('system.secret-name')])).toThrow('Agents cannot read this database or collection.');
  });
});

describe('listing filters', () => {
  it('drops the denied databases and keeps the order of the rest', () => {
    expect(filterDatabases(['app', 'admin', 'local', 'config', 'zeta', 'Admin'])).toEqual(['app', 'zeta']);
  });

  it('drops system collections and keeps the order of the rest', () => {
    expect(filterCollections(['orders', 'system.views', 'system.profile', 'users', 'systems'])).toEqual(['orders', 'users', 'systems']);
  });

  it('returns an empty list for nothing', () => {
    expect(filterDatabases([])).toEqual([]);
    expect(filterCollections([])).toEqual([]);
  });
});

describe('cutName', () => {
  it('keeps a name of up to 256 characters and cuts a longer one to 256', () => {
    expect(cutName('a'.repeat(256))).toBe('a'.repeat(256));
    expect(cutName('a'.repeat(257))).toBe('a'.repeat(256));
    expect(cutName('a'.repeat(5000)).length).toBe(256);
  });

  it('takes the limit as a parameter', () => {
    expect(cutName('abcdef', 3)).toBe('abc');
    expect(cutName('abc', 3)).toBe('abc');
    expect(cutName('', 3)).toBe('');
  });
});

describe('visibleDatabaseNames', () => {
  it('drops the denied databases in any case, sorts with localeCompare and cuts each name to 256', () => {
    const long = 'z'.repeat(300);
    expect(visibleDatabaseNames(['zeta', 'admin', 'Alpha', 'LOCAL', 'config', 'beta', long])).toEqual(
      ['Alpha', 'beta', 'zeta', 'z'.repeat(256)].sort((a, b) => a.localeCompare(b)),
    );
    expect(visibleDatabaseNames([])).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const names = ['b', 'admin', 'a'];
    visibleDatabaseNames(names);
    expect(names).toEqual(['b', 'admin', 'a']);
  });
});

describe('visibleCollections', () => {
  it('drops system.* collections, sorts by name, cuts each name to 256 and keeps the known kinds', () => {
    const long = 'c'.repeat(300);
    const out = visibleCollections([
      { name: 'orders', type: 'collection' },
      { name: 'system.views', type: 'collection' },
      { name: 'v', type: 'view' },
      { name: 'ts', type: 'timeseries' },
      { name: 'system.', type: 'collection' },
      { name: long, type: 'collection' },
      { name: 'a' },
    ]);
    expect(out).toEqual(
      [
        { name: 'a', type: 'collection' },
        { name: 'c'.repeat(256), type: 'collection' },
        { name: 'orders', type: 'collection' },
        { name: 'ts', type: 'timeseries' },
        { name: 'v', type: 'view' },
      ].sort((x, y) => x.name.localeCompare(y.name)),
    );
  });

  it('shows a kind the server invented, or a non-string one, as a plain collection', () => {
    expect(visibleCollections([{ name: 'a', type: 'weird' }, { name: 'b', type: 7 }, { name: 'c', type: 'View' }])).toEqual([
      { name: 'a', type: 'collection' },
      { name: 'b', type: 'collection' },
      { name: 'c', type: 'collection' },
    ]);
  });
});
