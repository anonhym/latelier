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
 * Box 2 (`aria-activedescendant` still names a row that exists) rides along:
 * `openMenuFor` sets `focusedId` to the row the menu was opened on, and nothing
 * in `useNavigatorDialogs`'s success handlers touched it. `DbCollectionNavigator`'s
 * reconciliation effect *did* already re-point `focusedId` when it went stale,
 * but its fallback was `activeId ?? rows[0]?.id`, unconditionally trusting
 * `activeId` (`coll:<conn>:<db>:<activeCollection>` from props) even once that
 * exact row was the one just dropped/renamed out of `rows`. Since `activeId` is
 * a template string built from props, not a lookup, it stays non-null forever —
 * `rows[0]` was never reached, `focusedId` calcified on a row that can never
 * come back, and `aria-activedescendant` (which only renders when
 * `rows.find(...)` succeeds — see `activeDescendantId`) went from naming the
 * dropped row to naming nothing at all: the attribute disappears, not a
 * dangling reference. Fixed in `DbCollectionNavigator.tsx` by no longer trusting
 * a stale `activeId` — but *only* once there's enough information to call it
 * confirmed gone rather than merely not loaded in yet, or unreachable because
 * the connection is down: distrust requires the connection to be `connected`,
 * its db list loaded, and (if the active db itself still exists) that db's
 * collections loaded too — checked at the db level rather than the specific
 * collection's own cache entry, because a *dropped database* never gets
 * `loadColls` called for it again and that entry would otherwise stay "not
 * loaded" forever. Two regressions this guarded against on the way here:
 *  - A plain "does `activeId` exist in `rows` right now" check, with no
 *    "not loaded yet" exception, broke seven cases in
 *    `navigator-accordion.spec.tsx` that rely on the original optimistic
 *    first-load behaviour (a fresh tab's `activeId` doesn't exist in `rows`
 *    for the one render before its db/colls finish loading) — caught by
 *    running the full component project, not just this file.
 *  - A first attempt at that exception — trust `activeId` until it's been
 *    "seen" valid once, then never again once it disappears — broke
 *    disconnect/reconnect: a disconnect makes `activeId`'s row vanish from
 *    `rows` too (same as a drop, from `rows`' point of view), so "seen, now
 *    gone" fired there as well and reconnect never got the active collection
 *    focused again. The full component project did *not* catch this one —
 *    nothing in the suite drove a disconnect/reconnect cycle with a live
 *    active collection — it surfaced only from a hand-built repro, which is
 *    now the "reconnecting after a disconnect" case below. The connection-
 *    status check (`activeConnConnected`) is what actually tells the two
 *    apart; that case's kill line is turning it into `true` unconditionally.
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
describe('DbCollectionNavigator — context-menu dialogs return focus to the tree on success', () => {
  it('Drop collection: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    mountNavigator();
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
    // `orders` is gone; the reconciliation effect falls all the way back to
    // `rows[0]` — the connection row, the one thing guaranteed to survive any
    // drop — rather than calcifying on the now-nonexistent `activeId`.
    await waitFor(() =>
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1'),
    );
  });

  it('Drop database: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    mountNavigator();
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
    await waitFor(() =>
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1'),
    );
  });

  it('Rename collection: success returns focus to the tree, and aria-activedescendant falls back to a row that exists', async () => {
    statefulMocks();
    mountNavigator();
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
    // The old `coll:...:orders` id is gone (renamed to `archive`); `activeId`
    // still names the pre-rename collection (props don't change under this
    // test), so the fallback to `rows[0]` is exercised here too.
    await waitFor(() =>
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1'),
    );
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

  /**
   * Not one of the four dialogs — pins the box-2 fix itself against a second
   * regression it caused on the way to landing (see this describe block's
   * header comment). `DbCollectionNavigator`'s reconciliation effect must
   * distrust a stale `activeId` once it's *confirmed* gone (a drop/rename),
   * but a disconnect also makes `activeId`'s row vanish from `rows` — and
   * that one must NOT be treated as "gone for good": reconnecting should put
   * `aria-activedescendant` back on the active collection, not strand it on
   * the `rows[0]` fallback forever. Kill line: `activeConnConnected` — the
   * connection-status check `DbCollectionNavigator.tsx`'s reconciliation
   * effect uses — hardcoded to `true`. Red: `expected
   * "navigator-row-conn:c1" to be "navigator-row-coll:c1:shop:orders"`.
   */
  it('reconnecting after a disconnect puts aria-activedescendant back on the active collection, not the fallback row', async () => {
    statefulMocks();
    const { rerender } = mountNavigator({ connectionsWithTabs: new Set(['c1']) });
    await screen.findByText('orders');

    const tree = screen.getByRole('tree');
    await waitFor(() =>
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-coll:c1:shop:orders'),
    );

    rerender(
      <DbCollectionNavigator
        connectionsWithTabs={new Set(['c1'])}
        connections={[connectionFixture({ id: 'c1', name: 'Prod', status: 'disconnected' })]}
        focusedConnectionId="c1"
        activeDbName="shop"
        activeCollection="orders"
        onOpenCollection={vi.fn()}
        onOpenAggregation={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.queryByTestId('nav-coll-shop-orders')).toBeNull());

    rerender(
      <DbCollectionNavigator
        connectionsWithTabs={new Set(['c1'])}
        connections={[connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })]}
        focusedConnectionId="c1"
        activeDbName="shop"
        activeCollection="orders"
        onOpenCollection={vi.fn()}
        onOpenAggregation={vi.fn()}
      />,
    );
    await screen.findByTestId('nav-coll-shop-orders');
    await waitFor(() =>
      expect(tree.getAttribute('aria-activedescendant')).toBe('navigator-row-coll:c1:shop:orders'),
    );
  });
});
