// W05 §9.7, W15 §16, W01 §14.11 — the Inspector (the right-hand panel with a
// Filter and a Plan tab) and the keyboard set around it: ⌘B / ⌘⇧B / ⌘L /
// ⌥1–⌥3 / ⌘↓ / Esc. Each global key is inert under a dialog.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { modals } from '@mantine/modals';
import { render, screen, waitFor, fireEvent, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { Inspector, type PlanRequest } from '../../src/pages/Workspace/Inspector';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { commandRegistry } from '../../src/commands/registry';
import { STATIC_SHORTCUTS } from '../../src/commands/staticShortcuts';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab, CollectionTabState, CollectionView, ConnectionSummary } from '@shared/types';

const now = '2026-01-01T00:00:00.000Z';

const conn: ConnectionSummary = {
  id: 'c1',
  name: 'Prod',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
};

function stateOf(activeView: CollectionView = 'documents'): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    activeView,
    lastRun: { documents: [{ _id: 'a1', sku: 'widget' }], durationMs: 2, ranAt: now },
  };
}

function tabOf(activeView: CollectionView = 'documents'): CollectionTab {
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
    state: stateOf(activeView),
  };
}

/** `builderCollapsed`: undefined is a profile that never chose. */
function mountWorkspace(options: { view?: CollectionView; builderCollapsed?: boolean; explain?: (...args: unknown[]) => Promise<unknown> } = {}) {
  const tab = tabOf(options.view);
  const explain = vi.fn<(...args: unknown[]) => Promise<unknown>>(
    options.explain ??
      (async () => ({ plan: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } }, verbosity: 'queryPlanner' })),
  );
  installAtelierMock({
    tabs: { list: async () => [tab], setActive: async (id) => ({ id }), update: async () => tab },
    conn: { list: async () => [conn] },
    prefs: {
      get: (async (key: string) =>
        key === 'ui.workspace.builderCollapsed' && options.builderCollapsed !== undefined
          ? options.builderCollapsed
          : null) as never,
    },
    query: {
      find: async () => ({ documents: [{ _id: 'a1', sku: 'widget' }], durationMs: 1, hasMore: false }),
      count: async () => ({ count: 1 }),
      explain: explain as never,
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { explain };
}

const ready = async () => {
  await waitFor(() => expect(screen.getByRole('banner').textContent).toContain('Prod'));
};
const strip = () => screen.queryByRole('tablist', { name: 'Inspector view' });
const filterInput = () => document.getElementById('query-bar-filter') as HTMLTextAreaElement;

async function openModal() {
  modals.openConfirmModal({
    title: 'Something',
    children: <input aria-label="a field" />,
    labels: { confirm: 'OK', cancel: 'Cancel' },
  });
  return screen.findByLabelText('a field');
}

afterEach(() => {
  uninstallAtelierMock();
  commandRegistry._resetForTests();
  vi.restoreAllMocks();
});

describe('the Inspector panel', () => {
  it('is closed for a fresh profile and open for a stored false', async () => {
    mountWorkspace();
    await ready();
    expect(strip()).toBeNull();
    expect(screen.getByRole('button', { name: /^Builder \(/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('opens on Filter, with a 36px header holding its title, the tab switch and close', async () => {
    mountWorkspace({ builderCollapsed: false });
    await ready();
    const list = await screen.findByRole('tablist', { name: 'Inspector view' });
    expect(within(list).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Filter', 'Plan']);
    expect(within(list).getByRole('tab', { name: 'Filter' }).getAttribute('aria-selected')).toBe('true');
    const inspector = screen.getByTestId('inspector');
    expect(within(inspector).getByText('Inspector')).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: 'Close inspector' })).toBeTruthy();
    // No Saved or Recent tab (W05 §9.6).
    expect(screen.queryByRole('tab', { name: /Saved|Recent/ })).toBeNull();
  });

  it('the Plan tab asks for the explain of the query when none was requested', async () => {
    const { explain } = mountWorkspace({ builderCollapsed: false });
    await ready();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plan' }));

    await waitFor(() => expect(explain).toHaveBeenCalledTimes(1));
    expect(explain.mock.calls[0]?.[0]).toMatchObject({ collection: 'orders', verbosity: 'queryPlanner' });
    const inspector = screen.getByTestId('inspector');
    await waitFor(() => expect(inspector.textContent).toContain('COLLSCAN'));
    expect(screen.getByRole('tab', { name: 'Plan' }).getAttribute('aria-selected')).toBe('true');

    // Back on Filter, the builder is still there.
    fireEvent.click(screen.getByRole('tab', { name: 'Filter' }));
    expect(await screen.findByRole('button', { name: 'Reset' })).toBeTruthy();
  });

  it('opens on Filter again after it was closed on Plan', async () => {
    mountWorkspace({ builderCollapsed: false });
    await ready();
    fireEvent.click(await screen.findByRole('tab', { name: 'Plan' }));
    await screen.findByRole('tab', { name: 'Plan', selected: true });

    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    await waitFor(() => expect(strip()).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /^Builder \(/ }));

    expect((await screen.findByRole('tab', { name: 'Filter' })).getAttribute('aria-selected')).toBe('true');
  });

  it('Esc closes it and puts focus back on the Builder button', async () => {
    mountWorkspace({ builderCollapsed: false });
    await ready();
    const filter = await screen.findByRole('tab', { name: 'Filter' });
    filter.focus();

    fireEvent.keyDown(filter, { key: 'Escape' });

    await waitFor(() => expect(strip()).toBeNull());
    expect(screen.getByRole('button', { name: /^Builder \(/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('Esc in an operator box cancels that edit and leaves the Inspector open', async () => {
    mountWorkspace({ builderCollapsed: false });
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    const op = (await screen.findByPlaceholderText('$op')) as HTMLInputElement;
    fireEvent.change(op, { target: { value: '>' } });
    fireEvent.keyDown(op, { key: 'Escape' });
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(strip()).not.toBeNull();
  });

  it('the Builder button keeps its name and shows ⌘⇧B in its tooltip', async () => {
    mountWorkspace();
    await ready();
    const button = screen.getByRole('button', { name: /^Builder \(/ });
    fireEvent.mouseEnter(button);
    expect(await screen.findByText(/Builder \((⌘⇧B|Ctrl\+Shift\+B)\)/)).toBeTruthy();
  });
});

describe('Inspector, on its own', () => {
  const plan: PlanRequest = { tabId: 't1', seq: 1, verbosity: 'queryPlanner', plan: { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } } };

  function renderInspector(overrides: { onClose?: () => void; parentKey?: () => void } = {}) {
    installAtelierMock({});
    const onClose = overrides.onClose ?? vi.fn();
    const parentKey = overrides.parentKey ?? vi.fn();
    render(
      // A plain parent with its own key handler: what a stopPropagation has to reach.
      <div onKeyDown={parentKey}>
        <CollectionWorkspaceProvider state={stateOf()} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta()}>
          <Inspector tab="filter" onTabChange={() => {}} onClose={onClose} plan={plan}>
            <button type="button">in the filter</button>
            <div role="listbox" aria-label="suggestions">
              <button type="button">option</button>
            </div>
            <div role="dialog" aria-label="inner">
              <button type="button">in a dialog</button>
            </div>
          </Inspector>
        </CollectionWorkspaceProvider>
      </div>,
    );
    return { onClose, parentKey };
  }

  it('Esc closes it and stops there', () => {
    const { onClose, parentKey } = renderInspector();
    fireEvent.keyDown(screen.getByRole('button', { name: 'in the filter' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentKey).not.toHaveBeenCalled();
  });

  it('leaves an Esc that belongs to an open popup or dialog inside it alone', () => {
    const { onClose } = renderInspector();
    fireEvent.keyDown(screen.getByRole('button', { name: 'option' }), { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('button', { name: 'in a dialog' }), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves an Esc someone already handled alone', () => {
    const { onClose } = renderInspector();
    const field = screen.getByRole('button', { name: 'in the filter' });
    field.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('⌘L focuses the filter', () => {
  it('from anywhere in the Documents view', async () => {
    mountWorkspace();
    await ready();
    await screen.findByTestId('query-bar-input');
    expect(document.activeElement).not.toBe(filterInput());

    fireEvent.keyDown(window, { key: 'l', metaKey: true });

    expect(document.activeElement).toBe(filterInput());
  });

  it('is inert under a dialog', async () => {
    mountWorkspace();
    await ready();
    const field = await openModal();

    fireEvent.keyDown(field, { key: 'l', metaKey: true, bubbles: true });

    expect(document.activeElement).not.toBe(filterInput());
  });

  it('leaves a keystroke already handled below alone (the Console clearing on Ctrl+L)', async () => {
    mountWorkspace();
    await ready();
    await screen.findByTestId('query-bar-input');
    const handled = document.createElement('div');
    handled.addEventListener('keydown', (ev) => ev.preventDefault());
    document.body.appendChild(handled);

    fireEvent.keyDown(handled, { key: 'l', ctrlKey: true, bubbles: true });

    expect(document.activeElement).not.toBe(filterInput());
    handled.remove();
  });

  it('does nothing outside the Documents view', async () => {
    mountWorkspace({ view: 'aggregation' });
    await ready();
    await screen.findByRole('tab', { name: /Aggregation/ });

    fireEvent.keyDown(window, { key: 'l', metaKey: true });

    expect(filterInput()).toBeNull();
  });
});

describe('⌥1 – ⌥3 switch the view', () => {
  const press = (n: 1 | 2 | 3, target: Element | Window = window) =>
    // Option-digit types a character on a Mac, so the code is what counts.
    fireEvent.keyDown(target, { key: ['¡', '™', '£'][n - 1], code: `Digit${n}`, altKey: true });
  const selected = (name: RegExp) => screen.getByRole('tab', { name }).getAttribute('aria-selected');

  it('go to Documents, Aggregation and Schema & indexes', async () => {
    mountWorkspace();
    await ready();
    await screen.findByRole('tab', { name: /Documents/ });

    press(2);
    await waitFor(() => expect(selected(/Aggregation/)).toBe('true'));
    press(3);
    await waitFor(() => expect(selected(/Schema & indexes/)).toBe('true'));
    press(1);
    await waitFor(() => expect(selected(/Documents/)).toBe('true'));
  });

  it('are ignored while focus is in a text field', async () => {
    mountWorkspace();
    await ready();
    const input = await screen.findByTestId('query-bar-input');

    press(2, input);

    await new Promise((r) => setTimeout(r, 20));
    expect(selected(/Documents/)).toBe('true');
  });

  it('are inert under a dialog', async () => {
    mountWorkspace();
    await ready();
    const field = await openModal();

    press(3, field);

    await new Promise((r) => setTimeout(r, 20));
    expect(selected(/Documents/)).toBe('true');
  });
});

describe('⌘↓ and Esc between the filter and the rows', () => {
  const rows = () => screen.findByRole('tree', { name: 'Documents' });

  it('⌘↓ moves focus to the results, Esc moves it back', async () => {
    mountWorkspace();
    await ready();
    const root = await rows();
    const filter = await screen.findByTestId('query-bar-input');
    filter.focus();

    fireEvent.keyDown(filter, { key: 'ArrowDown', metaKey: true });
    expect(document.activeElement).toBe(root);

    fireEvent.keyDown(root, { key: 'Escape' });
    expect(document.activeElement).toBe(filter);
  });

  it('⌘↓ is inert under a dialog', async () => {
    mountWorkspace();
    await ready();
    const root = await rows();
    const field = await openModal();

    fireEvent.keyDown(field, { key: 'ArrowDown', metaKey: true, bubbles: true });

    expect(document.activeElement).not.toBe(root);
  });

  it('Esc in a field being edited inside the rows is left to that field', async () => {
    mountWorkspace();
    await ready();
    const root = await rows();
    const stray = document.createElement('input');
    root.appendChild(stray);
    stray.focus();

    fireEvent.keyDown(stray, { key: 'Escape' });

    expect(document.activeElement).toBe(stray);
    stray.remove();
  });
});

describe('every shortcut is in the cheat sheet', () => {
  it('lists the new commands with their keys, and the two keys that are not commands', async () => {
    mountWorkspace();
    await ready();
    const keys = new Map(commandRegistry.list().map((c) => [c.id, [c.title, c.shortcut]]));
    expect(keys.get('view.sidebar.toggle')).toEqual(['Toggle sidebar', '⌘B']);
    expect(keys.get('query.drawer.toggle')).toEqual(['Query builder', '⌘⇧B']);
    expect(keys.get('query.focus')).toEqual(['Focus filter', '⌘L']);
    expect(keys.get('view.documents')).toEqual(['Go to documents', '⌥1']);
    expect(keys.get('view.aggregation')).toEqual(['Go to aggregation', '⌥2']);
    expect(keys.get('view.structure')).toEqual(['Go to schema & indexes', '⌥3']);

    const rows = STATIC_SHORTCUTS.flatMap((s) => s.items.map((i) => `${i.keys} ${i.title}`));
    expect(rows).toContain('⌘↓ From the filter, move to the first result row');
    expect(rows).toContain('Esc From the results, back to the filter');
    expect(rows).toContain('Esc Close the Inspector');
  });

  it('offers Copy query as… for the three targets, beside the Run menu', async () => {
    mountWorkspace();
    await ready();
    const ids = commandRegistry.list().filter((c) => c.id.startsWith('query.copy-as.')).map((c) => c.title);
    expect(ids).toEqual(['Copy query as mongosh', 'Copy query as Node.js', 'Copy query as Python']);
  });
});
