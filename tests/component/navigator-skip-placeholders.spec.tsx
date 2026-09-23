import { describe, it, expect, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { cleanup, render, screen, fireEvent } from '../helpers/render';
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
import type { CollectionInfo } from '../../shared/ipc';

// #66 — X19: arrow keys used to index blindly into the flattened row list,
// so ArrowDown/Up/Home/End/Right could land `focusedId` on a skeleton, an
// empty placeholder, or a connection-error row — none of which carry an id
// or a focus treatment. The decided direction (recorded on #66): skip them
// entirely in keyboard navigation. A connection error stays reachable
// because its Retry button is a real, Tab-reachable `<button role="alert">`
// child, and the connection row now `aria-describedby`s the error message.

function mount(props: Partial<DbCollectionNavigatorProps> = {}) {
  const baseProps: DbCollectionNavigatorProps = {
    connectionsWithTabs: new Set(),
    connections: [connectionFixture()],
    focusedConnectionId: null,
    activeDbName: null,
    activeCollection: null,
    onOpenCollection: vi.fn(),
    onOpenAggregation: vi.fn(),
    ...props,
  };
  return render(<DbCollectionNavigator {...baseProps} />);
}

const tree = () => screen.getByRole('tree');

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('DbCollectionNavigator — Retry stays reachable and usable from the keyboard (#66)', () => {
  it('Tab reaches the Retry button, and Enter on it retries without also toggling the root', async () => {
    const connect = vi.fn(async (id: string) => ({ id, status: 'connecting' as const }));
    installAtelierMock({ mongo: { connect } });
    const ERR = connectionFixture({ id: 'c1', name: 'Prod', status: 'error' });
    mount({ connections: [ERR] });

    const retryButton = await screen.findByRole('button', { name: 'Retry connecting to Prod' });
    const treeEl = tree();

    // Real focus onto the tree container, then make the connection row the
    // active descendant (a mount with no focusedConnectionId/activeDbName/
    // activeCollection never auto-focuses row 0 — the initial-focus effect
    // bails when both `focusedId` and its computed `activeId` are null — so
    // this ArrowDown is required to put `focusedId` on a real row before
    // Tabbing away; skipping it left `row` null in `onKeyDown`, which took
    // the early `if (!row) return` before ever reaching `preventDefault()`
    // and made the original version of this test pass on unfixed code too).
    // Then Tab into its one nested interactive descendant — Retry is the
    // only tabbable thing here since this Connection isn't 'connecting' (no
    // Cancel button) and isn't expanded.
    await userEvent.setup().click(treeEl);
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    await userEvent.tab();
    expect(document.activeElement).toBe(retryButton);

    // Before the fix, `onKeyDown`'s ancestor `preventDefault()` on Enter
    // cancels the button's own Enter-activates-click default action before
    // it can fire (same class of bug TableView/TreeView already guard
    // against), AND (since `row` now names the connection) also wrongly
    // toggles the root's own expand state — this assertion is RED without
    // the `e.target !== e.currentTarget` guard.
    await userEvent.keyboard('{Enter}');
    expect(connect).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledWith('c1');
    // The container's own Enter case (toggle the focused row) must NOT also
    // have fired.
    expect(treeEl.querySelector('[data-testid="nav-connection"]')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('Arrow keys pressed while focus is on Retry do not move the active row', async () => {
    installAtelierMock();
    const ERR = connectionFixture({ id: 'c1', name: 'Prod', status: 'error' });
    mount({ connections: [ERR] });

    const retryButton = await screen.findByRole('button', { name: 'Retry connecting to Prod' });
    const treeEl = tree();

    await userEvent.setup().click(treeEl);
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' }); // see the comment in the test above
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    await userEvent.tab();
    expect(document.activeElement).toBe(retryButton);
    const before = treeEl.getAttribute('aria-activedescendant');

    fireEvent.keyDown(retryButton, { key: 'ArrowDown' });
    fireEvent.keyDown(retryButton, { key: 'ArrowUp' });
    fireEvent.keyDown(retryButton, { key: 'Home' });
    fireEvent.keyDown(retryButton, { key: 'End' });

    expect(treeEl.getAttribute('aria-activedescendant')).toBe(before);
  });
});

describe('DbCollectionNavigator — a connection error is described, not just labelled (#66)', () => {
  it('the connection row aria-describedby names the error message element', async () => {
    installAtelierMock();
    const ERR = connectionFixture({ id: 'c1', name: 'Prod', status: 'error' });
    mount({ connections: [ERR] });

    const errorEl = await screen.findByTestId('nav-connection-error');
    const connRow = screen.getByTestId('nav-connection');

    const describedBy = connRow.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(errorEl.id).toBe(describedBy);
    expect(document.getElementById(describedBy!)?.textContent).toContain('Could not connect');
  });

  it('a connection with no error describes nothing', () => {
    installAtelierMock();
    mount({ connections: [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })] });

    expect(screen.getByTestId('nav-connection').hasAttribute('aria-describedby')).toBe(false);
  });
});

// The fixture below packs two placeholder-adjacent kinds into one static
// render: 'main' (expanded, connected) with 'loading-db' (colls loading,
// never resolves → 3x `skeleton` rows) and 'real-db' (colls loaded → real
// `coll` rows). No error connection here, and only two dbs, deliberately:
//
// - A THIRD expanded db alongside one stuck forever in `collsLoading`
//   reproduces a pre-existing virtualization/render quirk unrelated to #66:
//   clicking to expand a third db row while another is permanently loading
//   leaves that third row's own `aria-expanded` stuck at `false` even though
//   the click handler ran (reproduced against unmodified `main`, so it
//   predates this fix — not fixed here, out of this ticket's scope).
// - Adding a second connection (to also get a `conn-error` row into this
//   same render) pushes the total row count past what this test harness's
//   virtualization can reliably keep mounted through a long random key
//   sequence: `tests/helpers/jsdomSetup.ts` stubs every element's
//   `offsetHeight` to a flat 1000px (there is no real layout in jsdom), so
//   `useDynamicRowHeight` "measures" each newly-visited row at 1000px
//   instead of its real ~26px. With enough distinct rows visited before a
//   long jump, the accumulated (fictitious) height error pushes
//   `scrollToRow`'s target outside the mounted window and the destination
//   row never mounts at all — reproduced with 10 rows (this fixture plus an
//   error connection), gone at 8 (this fixture alone). This is a jsdom
//   measurement artifact, not a real rendering defect (a real browser
//   reports real row heights), so the fix here is to keep the fixture small
//   rather than chase it — `conn-error`'s own skip behaviour is already
//   covered by the dedicated `dberr` test below and by
//   navigator-cancel-and-failure.spec.tsx's failure-row test.
//
// `db-skeleton`, `db-empty`, `coll-empty` and the `dberr` conn-error variant
// can't be produced in the SAME render as this fixture's `skeleton`/`coll`
// rows anyway — they all require being the single expanded root
// (`caches`/`expanded` are keyed by one `expandedConnId`), and that slot is
// already spent on 'main'. Each gets its own small example-based test below.
const colls = (...names: string[]): CollectionInfo[] =>
  names.map((n) => ({
    name: n,
    type: 'collection' as const,
    documentCount: 0,
    sizeBytes: 0,
    indexCount: 0,
    capped: false,
  }));

function mixedFixture() {
  return installAtelierMock({
    meta: {
      listDatabases: async () => [
        { name: 'loading-db', sizeOnDisk: 1, empty: false },
        { name: 'real-db', sizeOnDisk: 1, empty: false },
      ],
      listCollections: async ({ dbName }) => {
        if (dbName === 'loading-db') return new Promise<CollectionInfo[]>(() => {});
        return colls('alpha', 'beta');
      },
    },
  });
}

function isTreeitemOrUndefined(activeDescendant: string | null): boolean {
  if (activeDescendant === null) return true;
  const el = document.getElementById(activeDescendant);
  return el !== null && el.getAttribute('role') === 'treeitem';
}

const KEYS = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'ArrowLeft', 'ArrowRight'] as const;

describe('DbCollectionNavigator — property: keyboard nav never lands off a treeitem (#66)', () => {
  it('after any sequence of Up/Down/Home/End/Left/Right, aria-activedescendant is undefined or names a treeitem', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom(...KEYS), { minLength: 1, maxLength: 15 }),
        async (keys) => {
          mixedFixture();
          const MAIN = connectionFixture({ id: 'main', name: 'Main', status: 'connected' });
          mount({ connections: [MAIN], focusedConnectionId: 'main' });
          try {
            for (const dbName of ['loading-db', 'real-db']) {
              const dbRow = await screen.findByTestId(`nav-db-${dbName}`);
              fireEvent.click(dbRow);
            }
            await screen.findByTestId('nav-coll-real-db-alpha');
            await screen.findAllByTestId('nav-coll-skeleton');
            const treeEl = tree();
            for (const key of keys) {
              fireEvent.keyDown(treeEl, { key });
              expect(isTreeitemOrUndefined(treeEl.getAttribute('aria-activedescendant'))).toBe(true);
            }
          } finally {
            cleanup();
            uninstallAtelierMock();
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('DbCollectionNavigator — the placeholder kinds the mixed fixture cannot host (#66)', () => {
  it('coll-empty: Down from a db with no collections skips the "No collections" placeholder', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'empty-db', sizeOnDisk: 1, empty: false }],
        listCollections: async () => [],
      },
    });
    mount({ connections: [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })], focusedConnectionId: 'c1' });
    const treeEl = tree();
    const dbRow = await screen.findByTestId('nav-db-empty-db');
    fireEvent.click(dbRow);
    await screen.findByText('No collections');

    fireEvent.keyDown(treeEl, { key: 'Home' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' }); // to the db row itself
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-db:c1:empty-db');
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' }); // must skip "No collections" — nothing further to land on
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-db:c1:empty-db');
    fireEvent.keyDown(treeEl, { key: 'ArrowRight' }); // stepping into the (empty) subtree moves nothing either
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-db:c1:empty-db');
  });

  it('db-skeleton: Down from the root skips straight past the loading-databases skeleton', async () => {
    installAtelierMock({
      meta: { listDatabases: () => new Promise(() => {}) },
    });
    mount({ connections: [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })], focusedConnectionId: 'c1' });
    const treeEl = tree();
    await screen.findAllByTestId('nav-db-skeleton');

    fireEvent.keyDown(treeEl, { key: 'Home' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' });
    // Only one navigable row exists (the root) while dbs are stuck loading —
    // Down must not move onto any of the three db-skeleton placeholders.
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
  });

  it('db-empty: Down from the root skips the "No databases." placeholder', async () => {
    installAtelierMock({ meta: { listDatabases: async () => [] } });
    mount({ connections: [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })], focusedConnectionId: 'c1' });
    const treeEl = tree();
    await screen.findByText('No databases.');

    // `focusedConnectionId` alone doesn't auto-focus a row (the initial-focus
    // effect also needs `activeDbName`/`activeCollection`, neither set here),
    // so this first Down is the one that reaches row 0 (the root) — on both
    // base and fixed code, since row 0 is never a placeholder. The SECOND
    // Down is the actual assertion: unfixed code blindly advances to row 1
    // (`db-empty`, a `nodbs:` row), which isn't one of the three navigable
    // kinds, so `aria-activedescendant` goes to `undefined` there — this is
    // RED (activedescendant becomes null, not this row) without the fix.
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    fireEvent.keyDown(treeEl, { key: 'ArrowDown' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
  });

  it('dberr: Down from the root skips a failed database list, End also lands back on the root', async () => {
    installAtelierMock({
      meta: { listDatabases: async () => { throw { code: 'DB_ERROR', message: 'nope' }; } },
    });
    mount({ connections: [connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' })], focusedConnectionId: 'c1' });
    const treeEl = tree();
    await screen.findByTestId('nav-connection-error');

    fireEvent.keyDown(treeEl, { key: 'ArrowDown' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');
    fireEvent.keyDown(treeEl, { key: 'End' });
    expect(treeEl.getAttribute('aria-activedescendant')).toBe('navigator-row-conn:c1');

    // And the root aria-describedby's the dberr message the same way a
    // connect-time error does.
    const describedBy = screen.getByTestId('nav-connection').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toContain('nope');
  });
});
