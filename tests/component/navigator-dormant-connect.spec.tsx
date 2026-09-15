import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, act, waitFor } from '../helpers/render';
import {
  DbCollectionNavigator,
  type DbCollectionNavigatorProps,
} from '../../src/pages/Workspace/DbCollectionNavigator';
import {
  connectionFixture,
  installAtelierMock,
  uninstallAtelierMock,
} from '../helpers/atelierMock';
import type { CollectionInfo } from '../../shared/ipc';

/**
 * X16.5, spec §4.7 — "Expanding a Dormant root connects it, then
 * expands." Before this ticket `toggleConnection` only ever flipped
 * `expandedConnId`; a Dormant root expanded into "Not connected. Nothing to
 * browse." forever, with no gesture that woke it.
 */

const PROD = connectionFixture({ id: 'c1', name: 'Prod', color: '#1A6835' });
const STAGING = connectionFixture({ id: 'c2', name: 'Staging', status: 'disconnected' });

const colls = (...names: string[]): CollectionInfo[] =>
  names.map((n) => ({
    name: n,
    type: 'collection' as const,
    documentCount: 0,
    sizeBytes: 0,
    indexCount: 0,
    capped: false,
  }));

function mount(props: Partial<DbCollectionNavigatorProps> = {}) {
  const baseProps: DbCollectionNavigatorProps = {
    // Staging is Dormant, not Saved: no live client, but a tab still open on
    // it. That is what earns it a root at all.
    connectionsWithTabs: new Set(['c2']),
    connections: [PROD, STAGING],
    focusedConnectionId: null,
    activeDbName: null,
    activeCollection: null,
    onOpenCollection: vi.fn(),
    onOpenAggregation: vi.fn(),
    ...props,
  };
  return render(<DbCollectionNavigator {...baseProps} />);
}

function root(name: string): HTMLElement {
  const rows = screen.getAllByTestId('nav-connection');
  const hit = rows.find((r) => within(r).queryByText(name));
  if (!hit) throw new Error(`no navigator root named ${name}`);
  return hit;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('expanding a Dormant root connects it, then expands', () => {
  it('connects the Dormant root on click, and expands it immediately', async () => {
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'shop', sizeOnDisk: 1, empty: false }],
        listCollections: async () => colls('orders'),
      },
      mongo: { connect },
    });
    mount();

    expect(root('Staging').getAttribute('aria-expanded')).toBe('false');

    await act(async () => {
      fireEvent.click(root('Staging'));
    });

    // The accordion doesn't wait on the connect to settle — it opens at once,
    // same as expanding an already-connected root.
    expect(root('Staging').getAttribute('aria-expanded')).toBe('true');
    expect(connect).toHaveBeenCalledWith('c2');
  });

  it('does not call connect when expanding a root that already has a live client', async () => {
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'shop', sizeOnDisk: 1, empty: false }],
        listCollections: async () => colls('orders'),
      },
      mongo: { connect },
    });
    mount();

    await act(async () => {
      fireEvent.click(root('Prod'));
    });

    expect(root('Prod').getAttribute('aria-expanded')).toBe('true');
    expect(connect).not.toHaveBeenCalled();
  });

  it('does not connect on collapse — only on the transition into expanded', async () => {
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({ mongo: { connect } });
    mount({ focusedConnectionId: 'c2' });

    await waitFor(() => expect(root('Staging').getAttribute('aria-expanded')).toBe('true'));
    connect.mockClear();

    await act(async () => {
      fireEvent.click(root('Staging'));
    });

    expect(root('Staging').getAttribute('aria-expanded')).toBe('false');
    expect(connect).not.toHaveBeenCalled();
  });

  it('the same wake gesture works from the keyboard (Enter / ArrowRight)', async () => {
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'shop', sizeOnDisk: 1, empty: false }],
        listCollections: async () => colls('orders'),
      },
      mongo: { connect },
    });
    mount();

    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' }); // Prod
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'ArrowDown' }); // Staging
    fireEvent.keyDown(screen.getByRole('tree'), { key: 'Enter' });

    expect(root('Staging').getAttribute('aria-expanded')).toBe('true');
    expect(connect).toHaveBeenCalledWith('c2');
  });
});
