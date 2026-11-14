// X07 §14.5 and Q11, against a real mounted `<Workspace/>` with no tab open:
// the sweep still lists the most recently connected Open Connection's
// collections, the palette says so while it waits, and a palette connect
// lands the navigator on that Connection's root.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { CommandPaletteRoot, usePaletteApi, _resetPaletteStoreForTests } from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { ConnectionPaletteCommands } from '../../src/commands/ConnectionPaletteCommands';
import { commandRegistry } from '../../src/commands/registry';
import { _resetPaletteCollectionsForTests } from '../../src/state/paletteCollections';
import { installAtelierMock, uninstallAtelierMock, connectionFixture } from '../helpers/atelierMock';
import type { CollectionInfo, DbInfo } from '@shared/ipc';

const coll = (name: string): CollectionInfo => ({
  name,
  type: 'collection',
  documentCount: 0,
  sizeBytes: 0,
  indexCount: 0,
  capped: false,
});
const db = (name: string): DbInfo => ({ name, sizeOnDisk: 1, empty: false });

const SERVER: Record<string, Record<string, string[]>> = {
  c1: { shop: ['orders', 'customers'], crm: ['leads'] },
  c2: { other: ['things'] },
};

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

/** Collection listings the test releases by hand, to hold the sweep in flight. */
function mount({ hold = false, state }: { hold?: boolean; state?: unknown } = {}) {
  const release: Array<() => void> = [];
  const listCollections = vi.fn(
    ({ connectionId, dbName }: { connectionId: string; dbName: string }) =>
      new Promise<CollectionInfo[]>((resolve) => {
        const done = () => resolve((SERVER[connectionId]?.[dbName] ?? []).map(coll));
        if (hold) release.push(done);
        else done();
      }),
  );
  const connect = vi.fn(async () => undefined);
  installAtelierMock({
    conn: {
      // c2 connected last, so it is the one a tabless sweep follows.
      list: async () => [
        connectionFixture({ id: 'c1', name: 'Prod', connectedAt: '2026-11-13T10:00:00.000Z' }),
        connectionFixture({ id: 'c2', name: 'Staging', connectedAt: '2026-11-13T12:00:00.000Z' }),
      ],
      touchUsed: async (id: string) => ({ id }),
    },
    tabs: { list: async () => [] },
    meta: {
      listDatabases: (async ({ connectionId }: { connectionId: string }) =>
        Object.keys(SERVER[connectionId] ?? {}).map(db)) as never,
      listCollections: listCollections as never,
    },
    mongo: { connect: connect as never, onStatus: () => () => {} },
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: '/workspace', state }]}>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <ConnectionPaletteCommands />
          <Workspace />
          <ToggleButton />
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
  return { listCollections, connect, release: () => act(() => release.splice(0).forEach((r) => r())) };
}

const dialog = () => screen.getByRole('dialog');
const search = (q: string) => fireEvent.change(screen.getByLabelText('Search commands'), { target: { value: q } });

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
  _resetPaletteCollectionsForTests();
  vi.restoreAllMocks();
});

describe('no tab open', () => {
  it('sweeps the most recently connected Open Connection, and lists its collections on an empty query', async () => {
    const { listCollections } = mount();
    await waitFor(() => expect(listCollections).toHaveBeenCalledWith({ connectionId: 'c2', dbName: 'other' }));
    expect(listCollections.mock.calls.some(([a]) => a.connectionId === 'c1')).toBe(false);

    fireEvent.click(screen.getByText('toggle'));
    const group = await within(dialog()).findByText('Collections in this connection');
    const rows = Array.from(group.closest('[role="group"]')!.querySelectorAll('[role="option"] [data-title]'));
    expect(rows.map((r) => r.getAttribute('data-title'))).toEqual(['other.things']);
  });

  it('finds a collection by name without the navigator being touched', async () => {
    const { listCollections } = mount();
    await waitFor(() => expect(listCollections).toHaveBeenCalled());
    fireEvent.click(screen.getByText('toggle'));
    search('things');
    await waitFor(() =>
      expect(within(dialog()).getAllByRole('option').some((o) => o.id.includes('tab.open:c2:other:things'))).toBe(true),
    );
  });

  it('says Loading collections… while the listing is in flight, and No matches once it settled empty', async () => {
    const { listCollections, release } = mount({ hold: true });
    await waitFor(() => expect(listCollections).toHaveBeenCalled());
    fireEvent.click(screen.getByText('toggle'));
    search('nothing-like-this');
    expect(within(dialog()).getByText('Loading collections…')).toBeTruthy();
    expect(within(dialog()).queryByText(/No matches/)).toBeNull();

    release();
    await within(dialog()).findByText('No matches for "nothing-like-this"');
    expect(within(dialog()).queryByText('Loading collections…')).toBeNull();
  });
});

describe('a palette connect (Q11)', () => {
  it('opens the navigator tree on that Connection, with its root the active row', async () => {
    const { connect } = mount({ state: { openConnectionId: 'c1' } });
    await waitFor(() => expect(connect).toHaveBeenCalledWith('c1'));
    const tree = await screen.findByRole('tree', { name: 'Databases and collections' });
    await waitFor(() => expect(document.activeElement).toBe(tree));
    expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
  });

  it('takes the tree focus only after Mantine\'s focus return to the palette\'s opener has run', async () => {
    // Open, choose the connection, close: Mantine returns focus to whatever
    // holds it 10 ms after the close, so the tree must ask later than that.
    const { connect } = mount();
    const opener = screen.getByText('toggle');
    opener.focus();
    fireEvent.click(opener);
    search('Staging');
    const row = await waitFor(() => {
      const found = within(dialog()).getAllByRole('option').find((o) => o.id.includes('connection.open:c2'));
      expect(found).toBeTruthy();
      return found!;
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      fireEvent.click(row);
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(connect).toHaveBeenCalledWith('c2');
      const tree = screen.getByRole('tree', { name: 'Databases and collections' });
      // Within Mantine's window the tree has not asked yet.
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(document.activeElement).not.toBe(tree);
      await act(() => vi.advanceTimersByTimeAsync(400));
      expect(document.activeElement).toBe(tree);
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c2');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not take the keyboard when no connect was asked for', async () => {
    mount();
    const tree = await screen.findByRole('tree', { name: 'Databases and collections' });
    await act(async () => {});
    expect(document.activeElement).not.toBe(tree);
  });
});
