import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '../helpers/render';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import {
  CommandPaletteRoot,
  usePaletteApi,
  _resetPaletteStoreForTests,
} from '../../src/commands/CommandPalette';
import { PaletteContextProvider, usePaletteContext } from '../../src/commands/PaletteContext';
import { commandRegistry } from '../../src/commands/registry';
import { ConnectionPaletteCommands } from '../../src/commands/ConnectionPaletteCommands';
import { installAtelierMock, multiConnectionMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { ConnectionSummary } from '@shared/types';

function conn(overrides: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id: 'c1',
    name: 'Prod',
    color: '#1A6835',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
    ...overrides,
  };
}

/** Renders which Connection the palette believes the Focused Tab is on. */
function ContextProbe() {
  const ctx = usePaletteContext();
  return <div data-testid="palette-connection">{ctx.connectionId ?? 'none'}</div>;
}

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

function app() {
  return (
    <MemoryRouter initialEntries={['/workspace']}>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <ConnectionPaletteCommands />
          <Workspace />
          <ContextProbe />
          <ToggleButton />
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>
  );
}

/**
 * Routed variant — `ConnectionPaletteCommands` is registered globally, so its
 * `connection.delete:<id>` / `connection.edit:<id>` rows fire from any route,
 * not just `/workspace`. Mirrors `app()` in
 * `tests/component/connection-palette-switch.spec.tsx`.
 */
function routedApp(initialEntries: string[]) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <ConnectionPaletteCommands />
          <ToggleButton />
          <Routes>
            <Route path="/workspace" element={<Workspace />} />
            <Route path="/connections/:id" element={<div>connection detail screen</div>} />
          </Routes>
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>
  );
}

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
});

/**
 * X16.5 — `connection.delete` used to be a single command gated on
 * `PaletteContext.connectionId` (the Focused Tab's Connection). After
 * After the tab-state rework, "a Connection is open but has no tab" is the normal state, so
 * that gate hid the command exactly when it was needed. It's now one
 * `connection.delete:<id>` / `connection.edit:<id>` per saved Connection,
 * registered by `ConnectionPaletteCommands` the same way `connection.open:<id>`
 * already is — the id is baked into `perform` at creation time, which is what
 * keeps a command's gate and its target from disagreeing (a bug class this avoids).
 */
describe('Workspace palette connection commands', () => {
  it('offers Delete and Edit for a Connection with no tabs open', async () => {
    // X16.5 — the opposite of the old "does not offer Delete when
    // there is no Focused Tab" test. A Connection can be open (status
    // 'connected') with no tab pointing at it at all — a Switcher row click
    // connects and opens no tab on purpose (spec §4.6) — and that is exactly
    // the case the palette must not go blind in.
    installAtelierMock({
      conn: { list: async () => [conn()] },
      tabs: { list: async () => [] },
    });

    render(app());

    fireEvent.click(screen.getByText('toggle'));
    expect(await screen.findByText('Delete connection → Prod')).toBeTruthy();
    expect(await screen.findByText('Edit connection → Prod')).toBeTruthy();
    // AC also names Refresh — untouched by this ticket (it's a whole-list
    // `conn.list()` refetch, not scoped to any one Connection, so it's still
    // gated on the route rather than baked per-id), but still owed coverage
    // that it's offered from the Data View at all.
    expect(screen.getByText('Refresh connection')).toBeTruthy();
  });

  // Two Connections, tabs on both, Focused Tab on Staging (c2) — not the
  // first Connection in the list, and not Prod either.
  async function renderTwoConnectionsFocusedOnStaging() {
    installAtelierMock({
      ...multiConnectionMock({
        connections: [conn(), conn({ id: 'c2', name: 'Staging' })],
        tabs: [
          { id: 't1', connectionId: 'c1', collection: 'orders' },
          { id: 't2', connectionId: 'c2', collection: 'events', isActive: true },
        ],
      }),
    });

    render(app());

    await waitFor(() => expect(screen.getByTestId('palette-connection').textContent).toBe('c2'));
  }

  // X16.1, spec §4.5 — the Focused Tab here is Staging (c2), not the
  // first Connection in the list. A reading that read `ctx.connectionId` at
  // call time (the old bug class) or that only offered the Focused Tab's
  // Connection would hand a "Delete Prod" pick to Staging, or hide "Delete
  // Prod" outright. Both are wrong: every Connection gets its own command,
  // baked-in id and all, regardless of what's focused.
  it('names and acts on the Connection the command says, not the Focused Tab', async () => {
    await renderTwoConnectionsFocusedOnStaging();

    // The Focused Tab's own Connection (Staging) still works…
    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(await screen.findByText('Delete connection → Staging'));
    expect(await screen.findByRole('dialog', { name: 'Delete "Staging"?' })).toBeTruthy();

    // …but so does a Connection that is NOT the Focused Tab's (Prod) — proof
    // the id is baked into `perform` at creation time, not read from
    // `PaletteContext` when the command runs.
    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(await screen.findByText('Delete connection → Prod'));
    expect(await screen.findByRole('dialog', { name: 'Delete "Prod"?' })).toBeTruthy();
  });

  it('cancelling from the palette-triggered dialog reaches the same ConnectionDeleteDialog', async () => {
    await renderTwoConnectionsFocusedOnStaging();

    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(await screen.findByText('Delete connection → Staging'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete "Staging"?' });

    // No special-casing for the palette route — Cancel behaves exactly like
    // any other trigger of the same shared dialog.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete "Staging"?' })).toBeNull(),
    );
  });

  // The command is registered globally, so it can fire from OUTSIDE
  // /workspace and land on a fresh Workspace mount whose own `connections`
  // hasn't resolved yet. `openDeleteConnectionModal` looks the id up in
  // `connections` and no-ops on a miss — acting (and clearing the nav state)
  // before that first load lands would drop the intent silently. Mirrors the
  // resolution-order test in connection-palette-switch.spec.tsx for
  // `openConnectionId`.
  it('a delete triggered from outside /workspace survives the fresh mount, even if connections resolve late', async () => {
    let connCallCount = 0;
    let resolveSecondConnList: (v: ConnectionSummary[]) => void = () => {};
    const secondConnListPromise = new Promise<ConnectionSummary[]>((resolve) => {
      resolveSecondConnList = resolve;
    });
    const connections = [conn()];
    const connList = vi.fn(async () => {
      connCallCount += 1;
      // Call #1 is ConnectionPaletteCommands' own subscription (mounted from
      // the start) — resolve immediately so the palette command is
      // clickable. Call #2 is Workspace's fresh-mount subscription — held
      // open so this test controls when it resolves relative to the intent.
      if (connCallCount === 1) return connections;
      return secondConnListPromise;
    });
    installAtelierMock({
      conn: { list: connList },
      tabs: { list: async () => [] },
    });

    render(routedApp(['/connections/c1']));
    expect(screen.getByText('connection detail screen')).toBeTruthy();

    fireEvent.click(screen.getByText('toggle'));
    fireEvent.click(await screen.findByText('Delete connection → Prod'));

    // Landed on Workspace, but its own `connections` is still empty — the
    // dialog must not have fired (and dropped the intent) against that.
    await waitFor(() => expect(screen.queryByText('connection detail screen')).toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Delete "Prod"?' })).toBeNull();

    await act(async () => {
      resolveSecondConnList(connections);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByRole('dialog', { name: 'Delete "Prod"?' })).toBeTruthy();
  });
});
