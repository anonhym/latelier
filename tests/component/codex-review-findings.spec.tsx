// Findings from the Codex review pass on the W15 ticket PRs.
// Each was reported against a merged commit, so these pin the fixes.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import { modals } from '@mantine/modals';
import Workspace from '../../src/pages/Workspace';
import { RecentTab } from '../../src/pages/Workspace/views/RecentTab';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab, ConnectionSummary, RecentQuery } from '@shared/types';

const now = new Date('2026-01-01T00:00:00Z').toISOString();

function recent(overrides: Partial<RecentQuery> = {}): RecentQuery {
  return {
    id: 'r1',
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    kind: 'find',
    payload: {
      kind: 'find',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{"status":{"$eq":"paid"}}',
    },
    ranAt: now,
    durationMs: 12,
    resultCount: 4,
    ...overrides,
  };
}

afterEach(() => {
  modals.closeAll();
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// ─── a per-row delete must not be able to reach another collection ───────────

describe('Recent per-row delete is bounded by what the tab is showing', () => {
  it('sends the full scope, not just the row id', async () => {
    const clear = vi.fn(async () => ({ deleted: 1 }));
    installAtelierMock({
      recent: { list: async () => [recent()], clear: clear as never },
    });
    render(
      <RecentTab connectionId="c1" dbName="shop" collection="orders" onRunHere={() => {}} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Delete .* from recent history$/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // The id alone would find the row — and that was the hazard. Sending the
    // scope means the delete ANDs down to nothing rather than to the wrong
    // collection's history if a stale row is ever on screen.
    await waitFor(() =>
      expect(clear).toHaveBeenCalledWith({
        id: 'r1',
        connectionId: 'c1',
        dbName: 'shop',
        collection: 'orders',
        kind: 'find',
      }),
    );
  });

  it('ignores a list response that arrives after a newer one', async () => {
    let resolveFirst: ((v: RecentQuery[]) => void) | undefined;
    const first = new Promise<RecentQuery[]>((r) => { resolveFirst = r; });
    let call = 0;
    const withQuery = (id: string, queryRaw: string, collection: string) =>
      recent({
        id,
        collection,
        payload: { kind: 'find', builder: { projection: [], sort: '', limit: '' }, queryRaw },
      });
    installAtelierMock({
      recent: {
        list: (async () => {
          call += 1;
          if (call === 1) return first;
          return [withQuery('current', '{"current":1}', 'orders')];
        }) as never,
      },
    });

    const { rerender } = render(
      <RecentTab connectionId="c1" dbName="shop" collection="invoices" onRunHere={() => {}} />,
    );
    // Switch collection before the first request settles — same instance, so
    // the component is reused rather than remounted.
    rerender(
      <RecentTab connectionId="c1" dbName="shop" collection="orders" onRunHere={() => {}} />,
    );
    await screen.findByText(/Recent · orders/);

    expect(within(await screen.findByTestId('recent-row')).getByText(/current/)).toBeTruthy();

    // The stale response lands last. `setItems` replaces rather than appends,
    // so counting rows proves nothing — the check has to be *which* row
    // survived. Without the token guard, the invoices row wins.
    resolveFirst?.([withQuery('stale', '{"invoices":1}', 'invoices')]);

    await new Promise((r) => { setTimeout(r, 20); });
    expect(screen.queryByText(/invoices/)).toBeNull();
    expect(within(screen.getByTestId('recent-row')).getByText(/current/)).toBeTruthy();
  });
});

// ─── ⌘B must not reach through an open dialog ─────────────────────────────────

function conn(): ConnectionSummary {
  return {
    id: 'c1',
    name: 'Prod',
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
  };
}

function collectionTab(): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'shop',
    collection: 'orders',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      view: 'Table',
      builder: { projection: [], sort: '', limit: '' },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
      activeView: 'documents',
    },
  };
}

// The Inspector starts closed (W15 §16); a stored choice opens it.
const inspectorOpenPrefs = {
  get: (async (key: string) => (key === 'ui.workspace.builderCollapsed' ? false : null)) as never,
};

async function mountWithInspectorOpen() {
  installAtelierMock({
    tabs: { list: async () => [collectionTab()] },
    conn: { list: async () => [conn()] },
    prefs: inspectorOpenPrefs,
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
  await screen.findByRole('tablist', { name: 'Inspector view' });
}

describe('the Inspector and sidebar shortcuts yield to an open dialog', () => {
  it('does not toggle the Inspector when ⌘⇧B is pressed inside a modal', async () => {
    await mountWithInspectorOpen();

    modals.openConfirmModal({
      title: 'Something',
      children: <input aria-label="a field" />,
      labels: { confirm: 'OK', cancel: 'Cancel' },
    });
    const field = await screen.findByLabelText('a field');

    fireEvent.keyDown(field, { key: 'B', metaKey: true, shiftKey: true, bubbles: true });

    // The Inspector behind the modal must be untouched — otherwise the shortcut
    // rearranges an obscured surface and drags focus out of the form.
    expect(screen.getByRole('tablist', { name: 'Inspector view' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Builder' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not toggle the sidebar when ⌘B is pressed inside a modal', async () => {
    await mountWithInspectorOpen();
    const pressed = () => screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('aria-pressed');
    const before = pressed();

    modals.openConfirmModal({
      title: 'Something',
      children: <input aria-label="a field" />,
      labels: { confirm: 'OK', cancel: 'Cancel' },
    });
    const field = await screen.findByLabelText('a field');

    fireEvent.keyDown(field, { key: 'b', metaKey: true, bubbles: true });

    expect(pressed()).toBe(before);
  });

  it('still toggles when the press comes from outside any dialog', async () => {
    await mountWithInspectorOpen();
    const pressed = () => screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('aria-pressed');
    const before = pressed();

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });
    await waitFor(() => expect(screen.queryByRole('tablist', { name: 'Inspector view' })).toBeNull());

    fireEvent.keyDown(window, { key: 'b', metaKey: true });
    await waitFor(() => expect(pressed()).not.toBe(before));
  });
});
