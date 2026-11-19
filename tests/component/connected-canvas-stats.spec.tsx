import { describe, it, expect, vi } from 'vitest';
import { render } from '../helpers/render';
import { ConnectedCanvas } from '../../src/pages/Workspace/ConnectedCanvas';
import { connectionFixture } from '../helpers/atelierMock';
import type { ConnectionCache } from '../../src/pages/Workspace/navigatorTreeReducer';
import type { CollectionInfo } from '@shared/ipc';

const names = (n: string, count: number): CollectionInfo[] =>
  Array.from({ length: count }, (_, i) => ({ name: `${n}${i}`, type: 'collection', capped: false }));

const cache = (over: Partial<ConnectionCache> = {}): ConnectionCache => ({
  dbs: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] as never,
  colls: { a: names('x', 5), b: names('y', 5), c: names('z', 5) },
  err: null,
  dbsLoading: false,
  collsLoading: {},
  ...over,
});

const mount = (c: ConnectionCache) => {
  const loadColls = vi.fn();
  const props = { connection: connectionFixture({ id: 'c1' }), loadDbs: vi.fn(), loadColls, onOpen: vi.fn(), onSearch: vi.fn() };
  const view = render(<ConnectedCanvas {...props} cache={c} />);
  return { loadColls, rerender: (next: ConnectionCache) => view.rerender(<ConnectedCanvas {...props} cache={next} />) };
};

describe('ConnectedCanvas counts', () => {
  it('reads the figures of the displayed databases only, once each', () => {
    const { loadColls, rerender } = mount(cache());
    // 8 rows: all of a (5) and the first three of b; c is not displayed.
    expect(loadColls.mock.calls).toEqual([
      ['c1', 'a', { stats: true }],
      ['c1', 'b', { stats: true }],
    ]);
    // Fresh figures landing, or any re-render, does not ask again.
    rerender(cache({ colls: { a: names('x', 5), b: names('y', 5), c: names('z', 5) }, collsLoading: {} }));
    rerender(cache({ collsLoading: { a: true } }));
    expect(loadColls).toHaveBeenCalledTimes(2);
  });

  it('waits for a database that is loading', () => {
    const { loadColls } = mount(cache({ collsLoading: { a: true } }));
    expect(loadColls.mock.calls).toEqual([['c1', 'b', { stats: true }]]);
  });
});
