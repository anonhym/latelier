import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { act, fireEvent, render, screen, within } from '../helpers/render';
import {
  DbCollectionNavigator,
  type DbCollectionNavigatorProps,
} from '../../src/pages/Workspace/DbCollectionNavigator';
import { connectionFixture, installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionInfo } from '@shared/ipc';

// The One Spine navigator (W02 §16): one selection style, counts that say what
// they count, a footer, a `Server` control on the root, a failure row that
// leads with the fix, and an Escape that means something in the filter.

const coll = (name: string): CollectionInfo => ({
  name,
  type: 'collection',
  documentCount: 0,
  sizeBytes: 0,
  indexCount: 0,
  capped: false,
});

function installTree() {
  installAtelierMock({
    meta: {
      listDatabases: async () => [
        { name: 'shop', sizeOnDisk: 1, empty: false },
        { name: 'config', sizeOnDisk: 1, empty: false },
      ],
      listCollections: async ({ dbName }) =>
        dbName === 'shop' ? [coll('orders'), coll('invoices'), coll('users')] : [],
    },
  });
}

function mount(props: Partial<DbCollectionNavigatorProps> = {}) {
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

const tree = () => screen.getByRole('tree', { name: 'Databases and collections' });
const row = (name: string) => screen.getByTestId(`nav-coll-shop-${name}`);
const rows = () => within(tree()).getAllByRole('treeitem');
const filled = () => rows().filter((r) => r.style.background !== '' && r.style.background !== 'transparent');
const outlined = () => rows().filter((r) => r.style.outline !== '' && r.style.outline !== 'none');

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Navigator: one selection style (W02 §16.2)', () => {
  const OPEN = [
    { connectionId: 'c1', dbName: 'shop', collection: 'orders' },
    { connectionId: 'c1', dbName: 'shop', collection: 'invoices' },
  ];

  it('fills exactly one row, the Focused Tab’s collection, and dots the other open one', async () => {
    installTree();
    mount({ openCollections: OPEN });
    await screen.findByText('orders');

    // Not the root, not the active database, not a row the keyboard last touched.
    expect(filled().map((r) => r.getAttribute('data-testid'))).toEqual(['nav-coll-shop-orders']);
    // The dot marks an open tab that is not in front: the filled row needs none.
    expect(within(row('invoices')).getByTestId('nav-open-tab-dot').textContent).toBe('Open in a tab');
    expect(within(row('orders')).queryByTestId('nav-open-tab-dot')).toBeNull();
    expect(within(row('users')).queryByTestId('nav-open-tab-dot')).toBeNull();
  });

  it('a tab open on another Connection’s collection of the same name dots nothing here', async () => {
    installTree();
    mount({ openCollections: [{ connectionId: 'c2', dbName: 'shop', collection: 'invoices' }] });
    await screen.findByText('orders');

    expect(screen.queryByTestId('nav-open-tab-dot')).toBeNull();
  });

  it('with a script tab focused, no collection row is filled or outlined', async () => {
    installTree();
    // A script tab binds to no namespace: the navigator is handed empty names.
    const view = mount({ openCollections: OPEN });
    await screen.findByText('orders');
    // The keyboard walks the tree, then focus leaves it for the tab strip.
    act(() => tree().focus());
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    expect(outlined()).toHaveLength(1);
    act(() => tree().blur());
    view.rerender(
      <DbCollectionNavigator
        connectionsWithTabs={new Set()}
        connections={[connectionFixture({ id: 'c1', name: 'Prod' })]}
        focusedConnectionId="c1"
        activeDbName=""
        activeCollection=""
        onOpenCollection={vi.fn()}
        onOpenAggregation={vi.fn()}
        openCollections={OPEN}
      />,
    );

    expect(filled()).toEqual([]);
    expect(outlined()).toEqual([]);
    // Still open in tabs, so still dotted.
    expect(screen.getAllByTestId('nav-open-tab-dot')).toHaveLength(2);
  });

  it('draws the focus ring only while the tree holds the keyboard, and never as a fill', async () => {
    installTree();
    mount();
    await screen.findByText('orders');
    expect(outlined()).toEqual([]);

    act(() => tree().focus());
    fireEvent.keyDown(tree(), { key: 'ArrowDown' });
    expect(outlined()).toHaveLength(1);
    expect(filled().map((r) => r.getAttribute('data-testid'))).toEqual(['nav-coll-shop-orders']);

    act(() => tree().blur());
    expect(outlined()).toEqual([]);
  });
});

describe('Navigator: counts, footer and the root (W02 §16.3–§16.4)', () => {
  it('a count says what it counts, as its tooltip and its accessible text', async () => {
    installTree();
    mount();
    await screen.findByText('orders');

    const db = screen.getByTestId('nav-db-shop');
    const count = within(db).getByTitle('3 collections');
    expect(count.textContent).toBe('33 collections');
    expect(count.querySelector('[aria-hidden]')?.textContent).toBe('3');
    expect(screen.getByTestId('nav-connection').getAttribute('aria-label')).toBe('Prod. Connected. 2 databases');
    expect(within(screen.getByTestId('nav-connection')).getByTitle('2 databases')).toBeTruthy();
  });

  it('counts one of a thing in the singular', async () => {
    installAtelierMock({
      meta: {
        listDatabases: async () => [{ name: 'shop', sizeOnDisk: 1, empty: false }],
        listCollections: async () => [coll('orders')],
      },
    });
    mount();
    await screen.findByText('orders');

    expect(within(screen.getByTestId('nav-db-shop')).getByTitle('1 collection')).toBeTruthy();
    expect(within(screen.getByTestId('nav-connection')).getByTitle('1 database')).toBeTruthy();
  });

  it('the footer’s + Add connection opens the form', async () => {
    installTree();
    const onAddConnection = vi.fn();
    mount({ onAddConnection });

    await userEvent.click(await screen.findByRole('button', { name: '+ Add connection' }));

    expect(onAddConnection).toHaveBeenCalledTimes(1);
  });

  it('the root shows Server and ⋯ on hover, and Server opens that Connection’s overview without toggling the root', async () => {
    installTree();
    const onOpenServer = vi.fn();
    mount({ onOpenServer });
    await screen.findByText('orders');
    const root = screen.getByTestId('nav-connection');
    expect(within(root).queryByRole('button', { name: 'Server overview for Prod' })).toBeNull();

    await userEvent.hover(root);
    await userEvent.click(within(root).getByRole('button', { name: 'Server overview for Prod' }));

    expect(onOpenServer).toHaveBeenCalledExactlyOnceWith('c1');
    expect(root.getAttribute('aria-expanded')).toBe('true');
    expect(within(root).getByRole('button', { name: 'Actions for Prod' })).toBeTruthy();
  });

  it('the root’s ⋯ opens its menu, which leads with Server overview', async () => {
    installTree();
    const onOpenServer = vi.fn();
    mount({ onOpenServer });
    await screen.findByText('orders');
    const root = screen.getByTestId('nav-connection');

    await userEvent.hover(root);
    await userEvent.click(within(root).getByRole('button', { name: 'Actions for Prod' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')[0]!.textContent).toBe('Server overview');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Server overview' }));

    expect(onOpenServer).toHaveBeenCalledExactlyOnceWith('c1');
  });
});

describe('Navigator: a failed connect leads with its fix (W02 §16.4)', () => {
  const failed = [connectionFixture({ id: 'c1', name: 'Prod', status: 'error' })];
  const failWith = (errorCode: 'AUTH' | 'NETWORK') =>
    installAtelierMock({
      mongo: {
        status: async () => ({ id: 'c1', status: 'error' as const, errorCode, errorMessage: 'it failed' }),
      },
    });
  const actions = () =>
    within(screen.getByTestId('nav-connection-error')).getAllByRole('button').map((b) => b.textContent);

  it('an authentication failure offers Edit credentials… first, opening the form on its password, with Retry second', async () => {
    failWith('AUTH');
    const onEditConnection = vi.fn();
    mount({ connections: failed, onEditConnection });

    const edit = await screen.findByRole('button', { name: 'Edit credentials for Prod' });
    expect(actions()).toEqual(['Edit credentials…', 'Retry']);
    fireEvent.click(edit);

    expect(onEditConnection).toHaveBeenCalledExactlyOnceWith('c1', edit, { focus: 'password' });
  });

  it('a network failure keeps Retry first and offers no credentials', async () => {
    failWith('NETWORK');
    mount({ connections: failed, onEditConnection: vi.fn() });

    await screen.findByText('it failed');
    expect(actions()).toEqual(['Retry']);
  });
});

describe('Navigator: Escape in the filter (W02 §16.5)', () => {
  it('clears what was typed, and a second Escape on the empty filter leaves the field', async () => {
    installTree();
    mount();
    await screen.findByText('orders');
    const filter = screen.getByRole('textbox', { name: 'Filter collections' }) as HTMLInputElement;
    expect(filter.placeholder).toBe('Filter collections');

    await userEvent.type(filter, 'inv');
    expect(screen.queryByText('orders')).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(filter.value).toBe('');
    expect(document.activeElement).toBe(filter);
    expect(await screen.findByText('orders')).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).not.toBe(filter);
  });
});
