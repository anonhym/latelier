import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '../helpers/render';
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

function navProps(props: Partial<DbCollectionNavigatorProps> = {}): DbCollectionNavigatorProps {
  return {
    connectionsWithTabs: new Set(),
    connections: [connectionFixture({ id: 'c1', name: 'Prod' })],
    focusedConnectionId: 'c1',
    activeDbName: 'shop',
    activeCollection: 'orders',
    onOpenCollection: vi.fn(),
    onOpenAggregation: vi.fn(),
    ...props,
  };
}

function mountNavigator(props: Partial<DbCollectionNavigatorProps> = {}) {
  const result = render(<DbCollectionNavigator {...navProps(props)} />);
  return {
    ...result,
    /**
     * #89 — re-render with changed `activeDbName`/`activeCollection`, the way
     * the real parent does. `ShellSection` wires `onCollectionDropped` /
     * `onDatabaseDropped` to `tabs.closeForNamespace` and `onCollectionRenamed`
     * to `tabs.retargetCollection`, so a successful mutation always moves the
     * active tab off the namespace it just changed. A test that holds these
     * props static is testing a state the app never durably reaches.
     */
    setActive: (next: Partial<DbCollectionNavigatorProps>) =>
      result.rerender(<DbCollectionNavigator {...navProps({ ...props, ...next })} />),
  };
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

const ordersColl = {
  name: 'orders',
  type: 'collection' as const,
  documentCount: 0,
  sizeBytes: 0,
  indexCount: 0,
  capped: false,
};

/**
 * A stateful `listDatabases`/`listCollections` pair, so a drop/rename/create
 * actually changes what the next fetch returns — a static mock would leave
 * the dropped row in `rows` forever and the box-2 `aria-activedescendant`
 * assertions below would pass against the unfixed `DbCollectionNavigator.tsx`
 * fallback regardless (the row it should have fallen back from would never
 * actually be gone). The `document.activeElement` assertion doesn't depend on
 * this — it goes red against the unfixed dialogs either way (see the
 * file-level note on `userEvent` vs `fireEvent` for that one's own trap).
 */
function statefulMocks() {
  let databases = [{ name: 'shop', sizeOnDisk: 1, empty: false }];
  let collections = [ordersColl];
  return installAtelierMock({
    meta: {
      listDatabases: async () => databases,
      listCollections: async () => collections,
    },
    collection: {
      create: async ({ collection }) => {
        collections = [...collections, { ...ordersColl, name: collection }];
        return { name: collection };
      },
      drop: async () => {
        collections = [];
        return { dropped: true };
      },
      rename: async ({ newName }) => {
        collections = collections.filter((c) => c.name !== 'orders').concat({ ...ordersColl, name: newName });
        return { name: newName };
      },
    },
    database: {
      drop: async () => {
        databases = [];
        collections = [];
        return { dropped: true as const };
      },
    },
  });
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

/**
 * #89 — the success path of the same four dialogs. `useDialogFocusReturn`
 * used to wrap only `onCancel`; the success callback (`onDropped`/`onRenamed`/
 * `onCreated`) called straight through and stranded focus on `<body>`, even
 * though every one of these dialogs is already handed the same
 * `returnFocusTo={menuTrigger}` the cancel case above proves works.
 *
 * `userEvent`, not `fireEvent`, for a different reason than the cancel cases:
 * these calls pass an explicit `returnFocusTo`, so the render-time capture
 * `useDialogFocusReturn` falls back to is irrelevant here — `trigger` is
 * `returnFocusTo` either way. What `userEvent` buys here is the real
 * trajectory: it moves focus onto the submit button before the click fires,
 * so the dialog actually unmounts out from under the focused element, the
 * same way a person clicking "Drop" does. Verified empirically: swapping
 * `user.click` for `fireEvent.click` on the submit button in the drop-
 * collection case below still goes red on unfixed code (`<body>`, not the
 * tree) — `fireEvent` never focuses the button, but closing the dialog still
 * leaves `document.activeElement` on `<body>` once it unmounts, so the
 * missing restore still shows. `userEvent` is kept because it's what box 4
 * asks for and because it's the trajectory a real user produces, not because
 * `fireEvent` would falsely pass here.
 *
 * Box 2 (`aria-activedescendant` still names a row that exists) rides along,
 * and needed no production code. It looks broken if you hold `activeDbName` /
 * `activeCollection` static across the mutation: `activeId`
 * (`coll:<conn>:<db>:<activeCollection>`) is a template string built from
 * props, not a lookup, so it stays non-null even once that exact row has been
 * dropped out of `rows`. The reconciliation effect's `activeId ?? rows[0]?.id`
 * then never reaches `rows[0]`, and `aria-activedescendant` — which only
 * renders once `rows.find(...)` succeeds, see `activeDescendantId` — goes
 * absent rather than dangling.
 *
 * The app never durably reaches that state, because those props are not
 * static: `ShellSection` wires `onCollectionDropped`/`onDatabaseDropped` to
 * `tabs.closeForNamespace` and `onCollectionRenamed` to
 * `tabs.retargetCollection`, so a successful mutation always moves the active
 * tab off the namespace it just changed, and `activeId` stops naming the
 * missing row on the very next render. Measured against unmodified
 * `DbCollectionNavigator.tsx` for all three mutations — collection drop and
 * database drop both land on `navigator-row-conn:c1`, rename follows the tab
 * to `navigator-row-coll:c1:shop:archive`, every one of them an element that
 * exists in the DOM.
 *
 * So these cases drive the parent's half of the contract through `setActive`
 * rather than freezing it. A version of this file that left the props static
 * did make a 28-line "is `activeId` confirmed gone" heuristic in
 * `DbCollectionNavigator.tsx` go green — but it was guarding a state only the
 * test produced, and it regressed seven `navigator-accordion.spec.tsx` cases
 * and then disconnect/reconnect on the way. Reverted; the assertion below
 * checks the id names a live element, which is what box 2 actually asks for.
 *
 * Box 3 (mechanism is `useDialogFocusReturn` with an explicit `returnFocusTo`,
 * not a hand-rolled `.focus()`) is satisfied structurally by the two-hook-call
 * shape in each dialog, matching #74. It is *not* separately provable by a red
 * test in this file: `ContextMenu`'s own `handleClose` (`ContextMenu.tsx`)
 * already calls `(focusTo ?? menu.returnFocusTo)?.focus()` synchronously,
 * inside the menu item's `onClick`, before React ever renders the dialog that
 * opens — so `useDialogFocusReturn`'s own render-time `captured` fallback
 * already equals the tree container for all four of these call sites by the
 * time any of them mount, independent of whether `returnFocusTo` is passed
 * down explicitly. Verified by instrumenting the hook and logging `trigger`
 * with the second argument temporarily omitted: it printed the tree element,
 * not a detached node. Box 1's kill line (delete the second hook call and use
 * the raw callback — see each dialog) is what actually enforces wrapping the
 * success path at all; passing `returnFocusTo` explicitly is still correct
 * (it's what #74 established, and it stops being redundant the moment a
 * caller opens one of these dialogs some other way), but has no independent
 * red state to point at here.
 */
/**
 * #89 box 2 — `aria-activedescendant` must name a row that *exists*, not merely
 * be present. `activeDescendantId` only renders once `rows.find(...)` succeeds,
 * so a stale id shows up as the attribute going absent rather than dangling;
 * asserting both catches either failure.
 */
async function expectActiveDescendantExists(tree: HTMLElement, expected: string) {
  await waitFor(() => expect(tree.getAttribute('aria-activedescendant')).toBe(expected));
  expect(document.getElementById(expected)).not.toBeNull();
}

describe('DbCollectionNavigator — context-menu dialogs return focus to the tree on success', () => {
  it('Drop collection: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    const { setActive } = mountNavigator();
    await screen.findByText('orders');

    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByTestId('nav-coll-shop-orders'));
    await user.click(await screen.findByRole('menuitem', { name: 'Drop collection' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Confirm collection name' }), 'orders');
    await user.click(within(dialog).getByRole('button', { name: 'Drop' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const tree = screen.getByRole('tree');
    await waitFor(() => expect(document.activeElement).toBe(tree));

    // The parent closes the dropped namespace's tab (`closeForNamespace`), so
    // `activeCollection` goes away with it.
    setActive({ activeCollection: undefined });
    await expectActiveDescendantExists(tree, 'navigator-row-conn:c1');
  });

  it('Drop database: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    const { setActive } = mountNavigator();
    await screen.findByText('orders');

    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByTestId('nav-db-shop'));
    await user.click(await screen.findByRole('menuitem', { name: 'Drop database' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Confirm database name' }), 'shop');
    await user.click(within(dialog).getByRole('button', { name: 'Drop database' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const tree = screen.getByRole('tree');
    await waitFor(() => expect(document.activeElement).toBe(tree));

    // `closeForNamespace({ connectionId, dbName })` closes every tab in the
    // dropped database, so both props go.
    setActive({ activeDbName: undefined, activeCollection: undefined });
    await expectActiveDescendantExists(tree, 'navigator-row-conn:c1');
  });

  it('Rename collection: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    const { setActive } = mountNavigator();
    await screen.findByText('orders');

    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getByTestId('nav-coll-shop-orders'));
    await user.click(await screen.findByRole('menuitem', { name: 'Rename collection' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'New name' }), 'archive');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const tree = screen.getByRole('tree');
    await waitFor(() => expect(document.activeElement).toBe(tree));

    // `retargetCollection` points the tab at the new name, so the active
    // collection follows the rename rather than vanishing.
    setActive({ activeCollection: 'archive' });
    await expectActiveDescendantExists(tree, 'navigator-row-coll:c1:shop:archive');
  });

  it('Create collection: success returns focus to the tree, and aria-activedescendant still names the row the menu was opened from', async () => {
    statefulMocks();
    mountNavigator();
    await screen.findByText('orders');

    const dbRow = screen.getByTestId('nav-db-shop');
    const user = userEvent.setup();
    fireEvent.contextMenu(dbRow);
    await user.click(await screen.findByRole('menuitem', { name: 'Create collection' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox', { name: 'Collection name' }), 'logs');
    await user.click(within(dialog).getByRole('button', { name: 'Create collection' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const tree = screen.getByRole('tree');
    await waitFor(() => expect(document.activeElement).toBe(tree));
    // Creating a collection doesn't remove the db row the menu was opened on,
    // so this one holds even without the `DbCollectionNavigator.tsx` fix —
    // included for box 4's per-dialog coverage, not as a box-2 regression test.
    expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-db:c1:shop');
  });

});
