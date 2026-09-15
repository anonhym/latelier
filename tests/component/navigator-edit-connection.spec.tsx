import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '../helpers/render';
import { MemoryRouter, useLocation } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { Connection, ConnectionSummary } from '@shared/types';

const now = '2026-07-26T12:00:00.000Z';

const PROD: ConnectionSummary = {
  id: 'c1',
  name: 'Prod',
  color: '#1A6835',
  host: 'prod.cluster0.mongodb.net',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
};

// A full `Connection` (not just the `ConnectionSummary` list rows use), to
// hydrate the edit-mode form via `conn.get` — mirrors CANNED_STAGING in
// tests/component/connection-switcher.spec.tsx.
const CANNED_PROD: Connection = {
  id: 'c1',
  name: 'Prod',
  color: '#1A6835',
  connectionType: 'standard',
  readOnly: false,
  host: 'prod.cluster0.mongodb.net',
  port: 27017,
  authMech: 'none',
  tls: { enabled: false, verify: true },
  advanced: {
    connectTimeoutMs: 10_000,
    socketTimeoutMs: 30_000,
    serverSelectionTimeoutMs: 30_000,
    readPreference: 'primary',
    maxPoolSize: 100,
    directConnection: false,
  },
  hasPasswordStored: false,
  hasSshPasswordStored: false,
  hasSshPassphraseStored: false,
  createdAt: now,
  updatedAt: now,
};

/** Renders the current pathname so a wrongful navigation is observable. */
function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="pathname">{loc.pathname}</div>;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

// the Data View used to carry two "edit connection" affordances with
// different behaviour: the Switcher's row-edit opens the settings
// form as a modal, but DbCollectionNavigator's own "Edit connection" context
// menu item still navigated to the full /connections/:id management screen.
// Repointed to the same `openEditConnectionModal` the Switcher uses.
describe('DbCollectionNavigator — Edit connection', () => {
  it('opens the same modal as the Switcher row-edit, without navigating away from the Data View', async () => {
    const getSpy = vi.fn(async () => CANNED_PROD);
    installAtelierMock({
      tabs: { list: async () => [] },
      conn: { list: async () => [PROD], get: getSpy as never },
    });

    render(
      // X16.1 — no tab is open, so the navigator's root comes from
      // choosing a Connection (the nav-state intent the Connections screen
      // sends), not from a restored pref.
      <MemoryRouter
        initialEntries={[{ pathname: '/workspace', state: { openConnectionId: 'c1' } }]}
      >
        <Workspace />
        <LocationProbe />
      </MemoryRouter>,
    );

    const row = await screen.findByTestId('nav-connection');
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit connection' }));

    expect(getSpy).toHaveBeenCalledWith('c1');
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Edit Connection' })).toBeTruthy());
    // Still the Data View underneath — a modal, not a navigation to the
    // ConnectionManager detail screen.
    expect(screen.getByTestId('pathname').textContent).toBe('/workspace');
  });
});
