// W15 §13.2 / §13.7 — the drawer's tab strip was three bare buttons
// distinguished by color and font-weight: no roles, no aria-selected, no
// aria-controls, and three separate tab stops instead of one.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-06T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

function makeCollectionTab(state: CollectionTabState): WorkspaceTab {
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
    state,
  };
}

const CONNECTION = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

function mountWith(state: CollectionTabState) {
  const savedListSpy = vi.fn(async () => []);
  const recentListSpy = vi.fn(async () => []);
  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: (async () => makeCollectionTab(state)) as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    saved: { list: savedListSpy as unknown as IpcApi['saved']['list'] },
    recent: { list: recentListSpy as unknown as IpcApi['recent']['list'] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
  });
  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, recentListSpy };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('W15 §13.2 — the drawer tab strip is a real tablist', () => {
  it('exposes tablist / tab / aria-selected / aria-controls', async () => {
    mountWith(makeState());

    // The Workspace renders other tablists (the workspace tab strip, the
    // collection-view switcher), so scope to this one by its name.
    const list = await screen.findByRole('tablist', { name: 'Query drawer' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Filter', 'Saved', 'Recent']);
    expect(tabs.every((t) => list.contains(t))).toBe(true);

    const [filter, saved, recent] = tabs;
    expect(filter.getAttribute('aria-selected')).toBe('true');
    expect(saved.getAttribute('aria-selected')).toBe('false');
    expect(recent.getAttribute('aria-selected')).toBe('false');

    // Each tab points at the panel it governs, and the selected one's panel
    // is really in the document.
    for (const t of tabs) expect(t.getAttribute('aria-controls')).toBeTruthy();
    expect(document.getElementById(filter.getAttribute('aria-controls')!)).toBeTruthy();
  });

  it('is a single tab stop: only the selected tab is keyboard-reachable', async () => {
    mountWith(makeState());

    const list = await screen.findByRole('tablist', { name: 'Query drawer' });
    const tabs = within(list).getAllByRole('tab');
    // Roving tabindex — exactly one tab participates in the Tab order.
    const reachable = tabs.filter((t) => t.getAttribute('tabindex') !== '-1');
    expect(reachable).toHaveLength(1);
    expect(reachable[0].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight moves selection to the next tab', async () => {
    mountWith(makeState());

    const filter = await screen.findByRole('tab', { name: 'Filter' });
    filter.focus();
    fireEvent.keyDown(filter, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'Saved' }).getAttribute('aria-selected')).toBe('true');
      expect(screen.getByRole('tab', { name: 'Filter' }).getAttribute('aria-selected')).toBe('false');
    });
  });

  it('does not mount the inactive panels — Recent fetches only once it is selected', async () => {
    const { recentListSpy } = mountWith(makeState());

    await screen.findByRole('tablist', { name: 'Query drawer' });
    // The Filter tab is active; Recent's list IPC must not have fired.
    await new Promise((r) => setTimeout(r, 20));
    expect(recentListSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('tab', { name: 'Recent' }));
    await waitFor(() => expect(recentListSpy).toHaveBeenCalled());
  });
});
