import { describe, it, expect } from 'vitest';
import { CollectionCountCache } from '../../electron/mongo/CollectionCountCache';

describe('CollectionCountCache', () => {
  it('returns what was stored for that connection, database and collection only', () => {
    const cache = new CollectionCountCache();
    cache.set('c1', 'shop', 'orders', { documentCount: 7 });
    expect(cache.get('c1', 'shop', 'orders')).toEqual({ documentCount: 7 });
    expect(cache.get('c2', 'shop', 'orders')).toBeUndefined();
    expect(cache.get('c1', 'other', 'orders')).toBeUndefined();
    expect(cache.get('c1', 'shop', 'items')).toBeUndefined();
  });

  it('clearConnection forgets that connection and keeps the others', () => {
    const cache = new CollectionCountCache();
    cache.set('c1', 'shop', 'orders', { documentCount: 1 });
    cache.set('c2', 'shop', 'orders', { documentCount: 2 });
    cache.clearConnection('c1');
    expect(cache.get('c1', 'shop', 'orders')).toBeUndefined();
    expect(cache.get('c2', 'shop', 'orders')).toEqual({ documentCount: 2 });
  });

  it('deleteMissing drops collections absent from the listing, in that database only', () => {
    const cache = new CollectionCountCache();
    cache.set('c1', 'shop', 'orders', { documentCount: 1 });
    cache.set('c1', 'shop', 'gone', { documentCount: 2 });
    cache.set('c1', 'shop2', 'gone', { documentCount: 3 });
    cache.deleteMissing('c1', 'shop', new Set(['orders']));
    expect(cache.get('c1', 'shop', 'orders')).toEqual({ documentCount: 1 });
    expect(cache.get('c1', 'shop', 'gone')).toBeUndefined();
    expect(cache.get('c1', 'shop2', 'gone')).toEqual({ documentCount: 3 });
  });

  it('ignores a write from a reader that started before the connection was cleared', () => {
    const cache = new CollectionCountCache();
    const before = cache.generation('c1');
    cache.clearConnection('c1');
    cache.set('c1', 'shop', 'orders', { documentCount: 9 }, before);
    expect(cache.get('c1', 'shop', 'orders')).toBeUndefined();
    cache.set('c1', 'shop', 'orders', { documentCount: 3 }, cache.generation('c1'));
    expect(cache.get('c1', 'shop', 'orders')).toEqual({ documentCount: 3 });
  });
});
