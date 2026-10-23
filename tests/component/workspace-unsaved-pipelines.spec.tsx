// The workspace reports how many pipelines hold unsaved changes, so the quit
// question can name them (#531). Main decides whether they count, from the
// "Reopen tabs on launch" pref; the renderer only reports.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, waitFor } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock, connectionFixture } from '../helpers/atelierMock';
import type { CollectionTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';
import { DEFAULT_AGGREGATION_TAB_STATE } from '@shared/defaults';

const NOW = '2026-08-01T12:00:00.000Z';

function tab(id: string, position: number, dirty: boolean | undefined): CollectionTab {
  return {
    id,
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'shop',
    collection: `orders${position}`,
    position,
    isActive: position === 0,
    openedAt: NOW,
    pinned: false,
    state: {
      view: 'Tree',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      lastRun: { documents: [{ _id: '1', sku: 'widget' }], durationMs: 1, ranAt: NOW },
      aggregation: { ...DEFAULT_AGGREGATION_TAB_STATE, dirty },
    },
  };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Workspace — unsaved pipelines report', () => {
  it('reports the number of collection tabs whose pipeline is dirty', async () => {
    const setUnsavedWork = vi.fn<IpcApi['app']['setUnsavedWork']>(async () => {});
    installAtelierMock({
      tabs: { list: async () => [tab('t1', 0, true), tab('t2', 1, false), tab('t3', 2, true), tab('t4', 3, undefined)] },
      conn: { list: async () => [connectionFixture({ id: 'c1' })] },
      app: { setUnsavedWork },
    });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(setUnsavedWork).toHaveBeenLastCalledWith({ source: 'pipelines', count: 2 }),
    );
    expect(setUnsavedWork.mock.calls.every(([input]) => input.source === 'pipelines')).toBe(true);
  });
});
