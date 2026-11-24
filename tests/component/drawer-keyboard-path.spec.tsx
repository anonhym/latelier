// W15 §13.6, W05 §9.7 — the Inspector's Builder toggle: the palette entry and
// ⌘⇧B, and the guard that keeps them from firing into a pane the user cannot
// see. ⌘B is the sidebar's (W01 §14.11).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import {
  CommandPaletteRoot,
  usePaletteApi,
  _resetPaletteStoreForTests,
} from '../../src/commands/CommandPalette';
import { PaletteContextProvider } from '../../src/commands/PaletteContext';
import { commandRegistry } from '../../src/commands/registry';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab, CollectionView, ConnectionSummary } from '@shared/types';

const now = new Date('2026-01-01T00:00:00Z').toISOString();

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

function collectionTab(activeView: CollectionView = 'documents'): CollectionTab {
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
      activeView,
    },
  };
}

function ToggleButton() {
  const palette = usePaletteApi();
  return <button onClick={palette.toggle}>toggle</button>;
}

function renderWorkspace(activeView: CollectionView = 'documents', builderCollapsed?: boolean) {
  installAtelierMock({
    tabs: { list: async () => [collectionTab(activeView)] },
    conn: { list: async () => [conn()] },
    prefs: {
      get: (async (key: string) =>
        key === 'ui.workspace.builderCollapsed' && builderCollapsed !== undefined ? builderCollapsed : null) as never,
    },
  });
  return render(
    <MemoryRouter initialEntries={['/workspace']}>
      <PaletteContextProvider>
        <CommandPaletteRoot>
          <Workspace />
          <ToggleButton />
        </CommandPaletteRoot>
      </PaletteContextProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  _resetPaletteStoreForTests();
});

const toggleButton = () => screen.getByRole('button', { name: /^Builder \(/ });

describe('the Query builder has a palette entry', () => {
  it('offers a toggle whose switch shows the Inspector’s state, off for a fresh profile', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));

    fireEvent.click(screen.getByText('toggle'));
    const row = screen.getByRole('option', { name: /^Query builder/ });
    expect(row.getAttribute('aria-checked')).toBe('false');
  });

  it('is on when the stored choice opened the Inspector', async () => {
    renderWorkspace('documents', false);
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    await screen.findByRole('tablist', { name: 'Inspector view' });

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.getByRole('option', { name: /^Query builder/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('is withheld in the aggregation view, where the builder is shut and hidden', async () => {
    renderWorkspace('aggregation');
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));

    fireEvent.click(screen.getByText('toggle'));
    expect(screen.queryByRole('option', { name: /^Query builder/ })).toBeNull();
  });
});

describe('⌘⇧B toggles the Inspector', () => {
  it('opens on Filter and puts focus on the selected tab', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    expect(screen.queryByRole('tablist', { name: 'Inspector view' })).toBeNull();

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });

    const filter = await screen.findByRole('tab', { name: 'Filter' });
    expect(filter.getAttribute('aria-selected')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(filter));
  });

  it('closes again and puts focus back on the Builder button', async () => {
    renderWorkspace('documents', false);
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    await screen.findByRole('tablist', { name: 'Inspector view' });

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });

    await waitFor(() => expect(screen.queryByRole('tablist', { name: 'Inspector view' })).toBeNull());
    // Focus must not be left where it was, or the shortcut changes the layout
    // out from under the user and the next Tab continues from nowhere useful.
    await waitFor(() => expect(document.activeElement).toBe(toggleButton()));
    expect(toggleButton().getAttribute('aria-pressed')).toBe('false');
  });

  it('is the Builder button’s own shortcut', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));

    fireEvent.click(toggleButton());
    expect(await screen.findByRole('tablist', { name: 'Inspector view' })).toBeTruthy();
    expect(toggleButton().getAttribute('aria-pressed')).toBe('true');
  });

  it('does nothing in the aggregation view', async () => {
    renderWorkspace('aggregation', false);
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    await screen.findByRole('tab', { name: /Aggregation/ });

    fireEvent.keyDown(window, { key: 'B', metaKey: true, shiftKey: true });

    // The stored state never flipped: Documents still shows the Inspector open.
    fireEvent.click(screen.getByRole('tab', { name: /Documents/ }));
    expect(await screen.findByRole('tablist', { name: 'Inspector view' })).toBeTruthy();
  });
});

describe('⌘B toggles the sidebar, not the builder', () => {
  it('leaves the Inspector alone', async () => {
    renderWorkspace('documents', false);
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    await screen.findByRole('tablist', { name: 'Inspector view' });
    const sidebar = () => screen.getByRole('button', { name: 'Toggle sidebar' }).getAttribute('aria-pressed');
    const before = sidebar();

    fireEvent.keyDown(window, { key: 'b', metaKey: true });

    await waitFor(() => expect(sidebar()).not.toBe(before));
    expect(screen.getByRole('tablist', { name: 'Inspector view' })).toBeTruthy();
  });
});

describe('the title bar’s Query Builder toggle', () => {
  const titleToggle = () => screen.getByRole('button', { name: /^Toggle Query Builder/ }) as HTMLButtonElement;

  it('opens and closes the Inspector, its pressed state tracking the Builder button', async () => {
    renderWorkspace();
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    expect(titleToggle().getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(titleToggle());
    expect(await screen.findByRole('tablist', { name: 'Inspector view' })).toBeTruthy();
    expect(titleToggle().getAttribute('aria-pressed')).toBe('true');
    expect(toggleButton().getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(titleToggle());
    await waitFor(() => expect(screen.queryByRole('tablist', { name: 'Inspector view' })).toBeNull());
    expect(titleToggle().getAttribute('aria-pressed')).toBe('false');
  });

  it('is disabled and unpressed in the aggregation view, where the panel is shut', async () => {
    renderWorkspace('aggregation', false);
    await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
    await screen.findByRole('tab', { name: /Aggregation/ });
    expect(titleToggle().disabled).toBe(true);
    expect(titleToggle().getAttribute('aria-pressed')).toBe('false');
  });
});
