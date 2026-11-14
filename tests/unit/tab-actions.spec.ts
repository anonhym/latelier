import { describe, expect, it } from 'vitest';
import { nextScriptTitle, tabLabel } from '../../src/pages/Workspace/tabActions';
import type { CollectionTab, ScriptTab, WorkspaceTab } from '@shared/types';

const coll = (id: string, dbName: string, collection: string): CollectionTab =>
  ({ id, kind: 'collection', connectionId: 'c1', dbName, collection, state: {} }) as CollectionTab;

const script = (id: string, title: string | undefined): ScriptTab =>
  ({ id, kind: 'script', connectionId: 'c1', state: { title } }) as unknown as ScriptTab;

describe('tabLabel with the open tabs', () => {
  it('keeps the bare collection name while no other tab shows it', () => {
    const a = coll('a', 'shop', 'orders');
    expect(tabLabel(a, [a, coll('b', 'shop', 'users')])).toBe('orders');
    // A tab never clashes with itself.
    expect(tabLabel(a, [a])).toBe('orders');
  });

  it('reads database.collection on both tabs of a clash, and the bare name again once one closes', () => {
    const a = coll('a', 'shop', 'orders');
    const b = coll('b', 'archive', 'orders');
    expect(tabLabel(a, [a, b])).toBe('shop.orders');
    expect(tabLabel(b, [a, b])).toBe('archive.orders');
    expect(tabLabel(a, [a])).toBe('orders');
  });

  it('qualifies a collection that a script title shadows, and never qualifies the script', () => {
    const a = coll('a', 'shop', 'orders');
    const s = script('s', 'orders');
    expect(tabLabel(a, [a, s])).toBe('shop.orders');
    expect(tabLabel(s, [a, s])).toBe('orders');
  });

  it('qualifies an unnamed collection by its placeholder', () => {
    const a = coll('a', 'shop', '');
    const b = coll('b', 'archive', '');
    expect(tabLabel(a, [a, b])).toBe('shop.(empty)');
  });
});

describe('nextScriptTitle', () => {
  it('starts at Script 1', () => {
    expect(nextScriptTitle([])).toBe('Script 1');
    expect(nextScriptTitle([coll('a', 'shop', 'orders')])).toBe('Script 1');
  });

  it('is one more than the highest default-titled open script', () => {
    const tabs: WorkspaceTab[] = [script('s1', 'Script 1'), script('s2', 'Script 12'), script('s3', 'Script 3')];
    expect(nextScriptTitle(tabs)).toBe('Script 13');
  });

  it('does not reuse a number freed by a closed script', () => {
    expect(nextScriptTitle([script('s2', 'Script 2')])).toBe('Script 3');
  });

  it('ignores renamed scripts, the legacy bare title, and look-alikes', () => {
    const tabs: WorkspaceTab[] = [
      script('a', 'seed users'),
      script('b', 'Script'),
      script('c', undefined),
      script('d', 'Script 9 draft'),
      script('e', 'My Script 9'),
      script('f', 'Script x'),
      // A collection named like a default title is not a script.
      coll('g', 'shop', 'Script 40'),
    ];
    expect(nextScriptTitle(tabs)).toBe('Script 1');
  });
});
