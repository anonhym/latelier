import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { LocationBreadcrumb } from '../../src/pages/Workspace/LocationBreadcrumb';
import { locationModel } from '../../src/pages/Workspace/locationModel';
import { collectionTabFixture, connectionFixture } from '../helpers/atelierMock';
import { emptyCache, type ConnectionCache } from '../../src/pages/Workspace/navigatorTreeReducer';
import type { CollectionInfo } from '@shared/ipc';
import type { ScriptTab, WorkspaceTab } from '@shared/types';

const prod = connectionFixture({ id: 'c1', name: 'Prod', status: 'connected' });
const coll = (name: string): CollectionInfo => ({ name, type: 'collection', capped: false });

function mount(active: WorkspaceTab | null, cache: ConnectionCache = emptyCache()) {
  const props = {
    switcherProps: {
      connections: [prod],
      focusedConnectionId: null,
      onSwitch: vi.fn(),
      onManage: vi.fn(),
      onDisconnect: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onExpand: vi.fn(),
    },
    loadDbs: vi.fn(),
    loadColls: vi.fn(),
    onOpenCollection: vi.fn(),
    onChooseCollection: vi.fn(),
  };
  render(
    <LocationBreadcrumb
      {...props}
      model={locationModel(active, [prod])!}
      active={active}
      caches={{ c1: cache }}
    />,
  );
  return { ...props, nav: within(screen.getByRole('navigation', { name: 'Location' })) };
}

const ordersTab = collectionTabFixture({ connectionId: 'c1', dbName: 'shop', collection: 'orders', isActive: true });
const shopCache: ConnectionCache = {
  ...emptyCache(),
  dbs: [{ name: 'shop', empty: false }, { name: 'crm', empty: false }],
  colls: { shop: [coll('orders'), coll('users'), coll('events')] },
};

describe('LocationBreadcrumb', () => {
  it('states connection › database › collection for a collection tab, the Switcher first', () => {
    const { nav } = mount(ordersTab, shopCache);
    const buttons = nav.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(buttons[0]).toMatch(/^Connection: Prod/);
    expect(buttons.slice(1)).toEqual(['Database: shop', 'Collection: orders']);
  });

  it('a script tab reads connection › title, the title as plain text', () => {
    const script = { ...ordersTab, kind: 'script', state: { title: 'Script 2' } } as unknown as ScriptTab;
    const { nav } = mount(script);
    expect(nav.getAllByRole('button')).toHaveLength(1);
    expect(nav.getByText('Script 2')).toBeTruthy();
  });

  it('with no tab, the second segment opens the palette on Collections', () => {
    const { nav, onChooseCollection } = mount(null);
    expect(nav.getByRole('button', { name: /^Connection: Prod/ })).toBeTruthy();
    fireEvent.click(nav.getByRole('button', { name: 'Choose a collection…' }));
    expect(onChooseCollection).toHaveBeenCalledOnce();
  });

  it('the database segment lists databases, then the chosen one’s collections in the same dropdown', async () => {
    const { nav, loadColls, onOpenCollection } = mount(ordersTab, shopCache);
    await userEvent.click(nav.getByRole('button', { name: 'Database: shop' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['shop', 'crm']);

    await userEvent.click(within(menu).getByRole('menuitem', { name: 'crm' }));
    // Not cached yet: asked for, and the dropdown stays open on it.
    expect(loadColls).toHaveBeenCalledWith('c1', 'crm');
    expect(within(screen.getByRole('menu')).getByText('Loading…')).toBeTruthy();

    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: '‹ Databases' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'shop' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'users' }));
    expect(onOpenCollection).toHaveBeenCalledWith(
      { connectionId: 'c1', dbName: 'shop', collection: 'users' },
      { newTab: false },
    );
  });

  it('the database segment loads the databases when the cache has none', async () => {
    const { nav, loadDbs } = mount(ordersTab);
    await userEvent.click(nav.getByRole('button', { name: 'Database: shop' }));
    await waitFor(() => expect(loadDbs).toHaveBeenCalledWith('c1'));
  });

  it('the collection segment lists siblings behind a filter; ⌘-click and ⌘↵ open a second tab', async () => {
    const { nav, onOpenCollection } = mount(ordersTab, shopCache);
    await userEvent.click(nav.getByRole('button', { name: 'Collection: orders' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'orders' }).getAttribute('aria-current')).toBe('true');

    fireEvent.change(within(menu).getByRole('textbox', { name: 'Filter collections' }), { target: { value: 'EV' } });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['events']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'events' }), { metaKey: true });
    expect(onOpenCollection).toHaveBeenLastCalledWith(
      { connectionId: 'c1', dbName: 'shop', collection: 'events' },
      { newTab: true },
    );

    await userEvent.click(nav.getByRole('button', { name: 'Collection: orders' }));
    const again = await screen.findByRole('menu');
    fireEvent.keyDown(within(again).getByRole('menuitem', { name: 'users' }), { key: 'Enter', metaKey: true });
    expect(onOpenCollection).toHaveBeenLastCalledWith(
      { connectionId: 'c1', dbName: 'shop', collection: 'users' },
      { newTab: true },
    );
    // The keydown is consumed, so the item never clicks: the menu closes itself.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });
});
