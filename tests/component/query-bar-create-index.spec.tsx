import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab, IndexInfo } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

/**
 * The find path's whole ExplainDrawer → Structure hop (W16 Tier 4): a
 * COLLSCAN explain shows "Create an index for this query", clicking it
 * closes the explain drawer, switches to Structure, and opens the
 * create-index drawer prefilled from the query that was just explained.
 */

const now = '2026-04-21T12:00:00.000Z';

function makeCollectionTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      view: 'Tree',
      builder: { projection: [], sort: '{"createdAt":-1}', limit: '' },
      queryRaw: '{"status":"active"}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      lastRun: { documents: [], durationMs: 0, ranAt: now },
    },
    ...overrides,
  };
}

const baseConn = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

const ID_INDEX: IndexInfo = {
  name: '_id_',
  key: [{ field: '_id', direction: 1 }],
  isIdIndex: true,
  unique: false,
  sparse: false,
  hidden: false,
  version: 2,
};

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function mountWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
}

async function openExplainMenu() {
  const chevron = await screen.findByTestId('query-run-options-btn');
  fireEvent.click(chevron);
  return chevron;
}

describe('QueryBar → ExplainDrawer → Structure — Create an index for this query', () => {
  it('lands in Structure with the create-index drawer prefilled in ESR order', async () => {
    const explainSpy = vi.fn<IpcApi['query']['explain']>(async () => ({
      plan: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } },
      verbosity: 'queryPlanner',
    }));
    const indexList = vi.fn(async () => [ID_INDEX]);

    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab()],
        setActive: async (id) => ({ id }),
        update: async () => makeCollectionTab(),
      },
      conn: { list: async () => [baseConn] },
      query: {
        find: async () => ({ documents: [], durationMs: 0, hasMore: false }),
        count: async () => ({ count: 0 }),
        explain: explainSpy,
      },
      index: { list: indexList },
      meta: { sampleSchema: async () => ({ docs: [] }) },
    });

    mountWorkspace();

    await openExplainMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'queryPlanner' }));

    const explainDialog = await screen.findByRole('dialog', { name: 'Explain plan' });
    await waitFor(() => expect(explainDialog.textContent).toContain('COLLSCAN'));

    const createButton = await screen.findByTestId('explain-create-index');
    fireEvent.click(createButton);

    // Explain drawer closes.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Explain plan' })).toBeNull(),
    );

    // Structure tab is now active.
    await waitFor(() => {
      const tab = screen.getByRole('tab', { name: /Structure/ });
      expect(tab.getAttribute('aria-selected')).toBe('true');
    });

    // Create-index drawer is open, prefilled: status (equality) then
    // createdAt desc (sort) — the query committed in `makeCollectionTab`.
    const createDialog = await screen.findByRole('dialog', { name: /New index/ });
    await waitFor(() => {
      expect((screen.getByLabelText('Field 1') as HTMLInputElement).value).toBe('status');
    });
    expect((screen.getByLabelText('Direction 1') as HTMLSelectElement).value).toBe('1');
    expect((screen.getByLabelText('Field 2') as HTMLInputElement).value).toBe('createdAt');
    expect((screen.getByLabelText('Direction 2') as HTMLSelectElement).value).toBe('-1');
    expect(createDialog.textContent).toContain("MongoDB's ESR order");
  });

  it('a query with no valid suggestion still opens the drawer, with the fields empty', async () => {
    const explainSpy = vi.fn<IpcApi['query']['explain']>(async () => ({
      plan: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } },
      verbosity: 'queryPlanner',
    }));

    installAtelierMock({
      tabs: {
        list: async () => [
          makeCollectionTab({
            state: {
              view: 'Tree',
              builder: { projection: [], sort: '', limit: '' },
              queryRaw: '{"$or":[{"a":1},{"b":2}]}',
              page: 0,
              pageSize: 50,
              activeBuilderTab: 'Builder',
              lastRun: { documents: [], durationMs: 0, ranAt: now },
            },
          }),
        ],
        setActive: async (id) => ({ id }),
        update: async () => makeCollectionTab(),
      },
      conn: { list: async () => [baseConn] },
      query: {
        find: async () => ({ documents: [], durationMs: 0, hasMore: false }),
        count: async () => ({ count: 0 }),
        explain: explainSpy,
      },
      index: { list: async () => [ID_INDEX] },
      meta: { sampleSchema: async () => ({ docs: [] }) },
    });

    mountWorkspace();

    await openExplainMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'queryPlanner' }));
    await screen.findByRole('dialog', { name: 'Explain plan' });

    fireEvent.click(await screen.findByTestId('explain-create-index'));

    await screen.findByRole('dialog', { name: /New index/ });
    await waitFor(() => {
      expect((screen.getByLabelText('Field 1') as HTMLInputElement).value).toBe('');
    });
  });
});
