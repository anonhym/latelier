import { describe, it, expect } from 'vitest';
import type { CollectionTab, ScriptTab } from '@shared/types';
import { CLOSED_TAB_CAP, closedTabOf, pushClosed, liveClosed, unsavedScriptTitles, withoutClosed, type ClosedTab } from '../../src/state/closedTabs';

const script = (over: Partial<ScriptTab> = {}): ScriptTab =>
  ({
    id: 's1',
    kind: 'script',
    connectionId: 'c1',
    dbName: '',
    collection: '',
    pinned: false,
    state: { title: 'Script 1', source: 'db.a.find()', lastResult: { valueJson: '1' }, lastError: { code: 'x', message: 'y' } },
    ...over,
  }) as unknown as ScriptTab;

const collection = (): CollectionTab =>
  ({
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    pinned: true,
    state: { queryRaw: '{a:1}', lastRun: { documents: [{ big: 1 }] }, aggregation: { stages: [], lastRun: { documents: [1] } } },
  }) as unknown as CollectionTab;

const entry = (n: number, connectionId = 'c1'): ClosedTab => ({ kind: 'script', connectionId, pinned: false, state: { title: `Script ${n}`, source: 'x' } });

describe('closedTabOf', () => {
  it('keeps a script\'s source and title and drops the last run', () => {
    const e = closedTabOf(script());
    expect(e).toEqual({ kind: 'script', connectionId: 'c1', pinned: false, state: { title: 'Script 1', source: 'db.a.find()' } });
  });

  it('keeps a collection tab\'s namespace, pin and query state and drops both result payloads', () => {
    const e = closedTabOf(collection());
    expect(e).toMatchObject({ kind: 'collection', connectionId: 'c1', dbName: 'shop', collection: 'orders', pinned: true });
    expect(e.state).toEqual({ queryRaw: '{a:1}', aggregation: { stages: [] } });
  });

  it('leaves a collection tab without an aggregation without one', () => {
    const tab = collection();
    delete (tab.state as { aggregation?: unknown }).aggregation;
    expect('aggregation' in closedTabOf(tab).state).toBe(false);
  });
});

describe('pushClosed', () => {
  it('puts the newest first', () => {
    expect(pushClosed([entry(1)], entry(2)).map((e) => (e.state as { title: string }).title)).toEqual(['Script 2', 'Script 1']);
  });

  it('keeps ten and drops the oldest', () => {
    let list: ClosedTab[] = [];
    for (let i = 1; i <= CLOSED_TAB_CAP + 2; i++) list = pushClosed(list, entry(i));
    expect(list).toHaveLength(10);
    expect((list[0]!.state as { title: string }).title).toBe('Script 12');
    expect((list[9]!.state as { title: string }).title).toBe('Script 3');
  });
});

describe('liveClosed', () => {
  it('keeps the entries of a live Connection in order', () => {
    const a = entry(1);
    const b = entry(2);
    expect(liveClosed([b, a], () => true)).toEqual([b, a]);
  });

  it('drops entries of a Connection that no longer exists, newer or older', () => {
    const gone1 = entry(1, 'gone');
    const live = entry(2, 'c1');
    const gone2 = entry(3, 'gone');
    expect(liveClosed([gone1, live, gone2], (id) => id === 'c1')).toEqual([live]);
  });

  it('answers an empty list for an empty list or one with no live entry', () => {
    expect(liveClosed([], () => true)).toEqual([]);
    expect(liveClosed([entry(1, 'gone')], () => false)).toEqual([]);
  });
});

describe('withoutClosed', () => {
  it('removes that entry only, by identity', () => {
    const a = entry(1);
    const same = { ...a };
    expect(withoutClosed([a, same], a)).toEqual([same]);
    expect(withoutClosed([a, same], a)[0]).toBe(same);
  });
});

describe('unsavedScriptTitles', () => {
  it('names the scripts that hold source, in order, and skips blank scripts and other tabs', () => {
    const tabs = [
      script({ state: { title: 'Cleanup', source: 'db.a.drop()' } as ScriptTab['state'] }),
      script({ state: { title: 'Empty', source: ' \n' } as ScriptTab['state'] }),
      collection(),
      script({ state: { title: '', source: '1' } as ScriptTab['state'] }),
    ];
    expect(unsavedScriptTitles(tabs)).toEqual(['Cleanup', 'Script']);
  });
});
