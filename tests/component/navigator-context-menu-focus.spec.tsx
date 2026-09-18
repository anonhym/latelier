import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import userEvent from '@testing-library/user-event';
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
 * The navigator half of the detached-trigger case, reached through `ContextMenu`.
 *
 * `ContextMenu` calls an item's `onClick` and then `onClose` in the same batch,
 * so the `Menu.Item` the user clicked is removed in the commit that mounts the
 * dialog. `useDialogFocusReturn`'s render-time capture therefore holds a node
 * that is already detached, `.focus()` on it is a silent no-op, and dismissing
 * the dialog lands on `<body>` — many tab stops from the tree.
 *
 * `userEvent.click` on the menu item is load-bearing: `fireEvent.click` focuses
 * nothing, so the capture would be `<body>` from the start and the test would
 * pass without ever reproducing the defect.
 *
 * #58 — the trigger these dialogs get handed changed from the row to the tree
 * container. Rows no longer carry a `tabIndex` (real focus lives on the
 * container; a row is only ever named via `aria-activedescendant` — see
 * `DbCollectionNavigator.tsx`'s `onRowContextMenu`), and a plain `<div>` with
 * no `tabIndex` is not a `.focus()` target at all, so keeping `menuTrigger` as
 * the row would silently reproduce the exact `<body>` bug this file exists to
 * catch. What still must hold: focus returns *inside the tree* and
 * `aria-activedescendant` still names the row the menu was opened from.
 */

function mountNavigator(props: Partial<DbCollectionNavigatorProps> = {}) {
  const baseProps: DbCollectionNavigatorProps = {
    connectionsWithTabs: new Set(),
    connections: [connectionFixture({ id: 'c1', name: 'Prod' })],
    focusedConnectionId: 'c1',
    activeDbName: 'shop',
    activeCollection: 'orders',
    onOpenCollection: vi.fn(),
    onOpenAggregation: vi.fn(),
    ...props,
  };
  return render(<DbCollectionNavigator {...baseProps} />);
}

function baseMocks() {
  return installAtelierMock({
    meta: {
      listDatabases: async () => [{ name: 'shop', sizeOnDisk: 1, empty: false }],
      listCollections: async () => [
        {
          name: 'orders',
          type: 'collection' as const,
          documentCount: 0,
          sizeBytes: 0,
          indexCount: 0,
          capped: false,
        },
      ],
    },
  });
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/** Right-click `rowTestId`, click `item`, then dismiss the dialog with `cancel`. */
async function openThenCancel(rowTestId: string, item: string, cancel: string) {
  const user = userEvent.setup();
  fireEvent.contextMenu(screen.getByTestId(rowTestId));
  await user.click(await screen.findByRole('menuitem', { name: item }));
  await screen.findByRole('dialog');
  await user.click(screen.getByRole('button', { name: cancel }));
}

describe('DbCollectionNavigator — context-menu dialogs return focus to the tree', () => {
  /**
   * MUTATION TARGET — drop `returnFocusTo={menuTrigger}` from any of the four
   * dialogs below and its case goes red on `<body>`.
   */
  const cases: [label: string, row: string, item: string, cancel: string][] = [
    ['Create collection', 'nav-db-shop', 'Create collection', 'Cancel'],
    ['Drop database', 'nav-db-shop', 'Drop database', 'Cancel'],
    ['Rename collection', 'nav-coll-shop-orders', 'Rename collection', 'Cancel'],
    ['Drop collection', 'nav-coll-shop-orders', 'Drop collection', 'Cancel'],
  ];

  for (const [label, row, item, cancel] of cases) {
    it(`${label} returns focus to the tree, still naming the row it was opened from`, async () => {
      baseMocks();
      mountNavigator();
      await screen.findByText('orders');

      const rowEl = screen.getByTestId(row);
      await openThenCancel(row, item, cancel);

      const tree = screen.getByRole('tree');
      await waitFor(() => expect(document.activeElement).toBe(tree));
      expect(tree.getAttribute('aria-activedescendant')).toBe(rowEl.id);
    });
  }

  /**
   * The connection row's "Edit connection" goes through `Workspace.tsx` rather
   * than a navigator-owned dialog, so it carries a focus-return target out as
   * an argument — the tree container, same as the four dialogs above, and not
   * the row (which can unmount out from under a virtualized scroll and is no
   * longer a `.focus()` target at all).
   */
  it('hands the tree container out with "Edit connection"', async () => {
    baseMocks();
    const onEditConnection = vi.fn();
    mountNavigator({ onEditConnection });
    await screen.findByText('orders');

    const rowEl = screen.getByTestId('nav-connection');
    const tree = screen.getByRole('tree');
    fireEvent.contextMenu(rowEl);
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Edit connection' }));

    expect(onEditConnection).toHaveBeenCalledWith('c1', tree);
  });
});
