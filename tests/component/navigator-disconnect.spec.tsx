import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import {
  DbCollectionNavigator,
  type DbCollectionNavigatorProps,
} from '../../src/pages/Workspace/DbCollectionNavigator';
import {
  connectionFixture,
  installAtelierMock,
  uninstallAtelierMock,
} from '../helpers/atelierMock';

/**
 * X16 §4.6 — the navigator root's context-menu "Disconnect" (real
 * Disconnect, only offered on a connected root) is wired to the caller's
 * `onDisconnect` prop rather than this component's own local `disconnect`
 * callback, so the caller can put a confirmation in front of it. "Cancel
 * connecting" — the same menu's item on a `connecting` root — stays wired to
 * the local callback and must not gain that treatment: it is cancelling an
 * attempt, not disconnecting an Open connection (spec §2's Connecting/Failed
 * row — tabs unchanged).
 */

const PROD = connectionFixture({ id: 'c1', name: 'Prod', color: '#1A6835', status: 'connected' });
const STAGING = connectionFixture({
  id: 'c2',
  name: 'Staging',
  color: '#8A5A00',
  status: 'connecting',
});

function mount(props: Partial<DbCollectionNavigatorProps> = {}) {
  const baseProps: DbCollectionNavigatorProps = {
    connectionsWithTabs: new Set(),
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

describe('DbCollectionNavigator — context-menu Disconnect', () => {
  it('the connected root\'s "Disconnect" menu item calls onDisconnect with the id and the menu\'s own trigger, not api.mongo.disconnect directly', async () => {
    const disconnect = vi.fn(async (id: string) => ({ id }));
    const onDisconnect = vi.fn();
    installAtelierMock({ mongo: { disconnect } });
    mount({ onDisconnect });

    fireEvent.contextMenu(root('Prod'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disconnect' }));

    // the second argument is the menu's opener, carried through so the
    // caller's confirm dialog can return focus to it once the `Menu.Item`
    // that triggered this is gone (same shape as `onEditConnection`).
    expect(onDisconnect).toHaveBeenCalledWith('c1', expect.anything());
    // The raw IPC call is the caller's job now (after its own confirm), not
    // this component's — regression against silently falling back to the
    // old unconfirmed local callback.
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('the "Disconnect" menu item is disabled, not silently inert, when onDisconnect is not supplied', () => {
    const disconnect = vi.fn(async (id: string) => ({ id }));
    installAtelierMock({ mongo: { disconnect } });
    mount();

    fireEvent.contextMenu(root('Prod'));
    const item = screen.getByRole('menuitem', { name: 'Disconnect' }) as HTMLButtonElement;
    expect(item.disabled).toBe(true);

    fireEvent.click(item);

    expect(disconnect).not.toHaveBeenCalled();
  });

  // Regression — the sibling surface this ticket must NOT touch. Same menu,
  // same component, but a `connecting` root's item is "Cancel connecting"
  // and stays on the local `disconnect` callback with no confirm gate.
  it('"Cancel connecting" on a connecting root still calls api.mongo.disconnect directly, with no confirmation and independent of onDisconnect', async () => {
    const disconnect = vi.fn(async (id: string) => ({ id }));
    const onDisconnect = vi.fn();
    installAtelierMock({ mongo: { disconnect } });
    mount({ onDisconnect });

    fireEvent.contextMenu(root('Staging'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel connecting' }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledWith('c2'));
    expect(onDisconnect).not.toHaveBeenCalled();
    // No confirmation dialog appeared — the click took effect immediately.
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/**
 * The navigator half of the detached-trigger case, full round trip through `Workspace.tsx` — the
 * `Menu.Item` that opened the confirm dialog is unmounted in the same commit
 * as the dialog mounts, exactly the shape
 * `navigator-context-menu-focus.spec.tsx` covers for Create/Drop/Rename
 * collection and Edit connection. Disconnect is the same menu, the same
 * defect class, and belongs to this ticket rather than that file's existing
 * cases, so it lives here instead of extending an unrelated ticket's file.
 */
describe('DbCollectionNavigator — context-menu Disconnect returns focus to the tree', () => {
  it('cancelling the confirm dialog opened from the context menu returns focus to the tree, not <body>', async () => {
    installAtelierMock({
      tabs: { list: async () => [] },
      conn: { list: async () => [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })] },
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/workspace', state: { openConnectionId: 'c1' } }]}>
        <Workspace />
      </MemoryRouter>,
    );

    const row = await screen.findByTestId('nav-connection');
    fireEvent.contextMenu(row);
    // `fireEvent.click` (used in the unit tests above) never moves focus, so
    // the capture would start at `<body>` and the test would pass whether or
    // not the fix is present — `userEvent.click` is load-bearing here,
    // matching `navigator-context-menu-focus.spec.tsx`'s own note.
    const user = userEvent.setup();
    await user.click(screen.getByRole('menuitem', { name: 'Disconnect' }));

    const dialog = await screen.findByRole('dialog', { name: 'Disconnect "Prod"?' });
    await user.click(within(dialog).getByText('Cancel'));

    // #58 — the trigger `onDisconnect` is handed is the tree container now,
    // not the row (see `navigator-context-menu-focus.spec.tsx`'s header
    // comment: a row has no `tabIndex` any more, so it's no longer a
    // `.focus()` target at all).
    const tree = screen.getByRole('tree');
    await waitFor(() => expect(document.activeElement).toBe(tree));
    expect(tree.getAttribute('aria-activedescendant')).toBe(row.id);
  });
});
