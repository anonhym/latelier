import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import {
  DbCollectionNavigator,
  type DbCollectionNavigatorProps,
} from '../../src/pages/Workspace/DbCollectionNavigator';
import {
  connectionFixture,
  installAtelierMock,
  uninstallAtelierMock,
} from '../helpers/atelierMock';

function setup() {
  installAtelierMock({
    meta: {
      listDatabases: async () => [
        { name: 'app', sizeOnDisk: 1, empty: false },
      ],
      listCollections: async () => [
        {
          name: 'users',
          type: 'collection',
          documentCount: 0,
          sizeBytes: 0,
          indexCount: 0,
          capped: false,
        },
      ],
    },
  });
  const onOpenCollection = vi.fn();
  const onOpenAggregation = vi.fn();
  const props: DbCollectionNavigatorProps = {
    connectionsWithTabs: new Set(),
    connections: [connectionFixture({ id: 'c1', name: 'Prod', color: '#1A6835' })],
    focusedConnectionId: 'c1',
    activeDbName: 'app',
    activeCollection: null,
    onOpenCollection,
    onOpenAggregation,
  };
  render(
      <DbCollectionNavigator {...props} />
  );
  return { onOpenCollection, onOpenAggregation };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('DbCollectionNavigator — click modifiers', () => {
  it('plain click activates existing (reuseExisting: true)', async () => {
    const { onOpenCollection, onOpenAggregation } = setup();
    const row = await screen.findByTestId('nav-coll-app-users');
    fireEvent.click(row);
    expect(onOpenCollection).toHaveBeenCalledWith(
      { connectionId: 'c1', dbName: 'app', collection: 'users' },
      { reuseExisting: true },
    );
    expect(onOpenAggregation).not.toHaveBeenCalled();
  });

  it('cmd/ctrl-click forces a new tab (reuseExisting: false)', async () => {
    const { onOpenCollection } = setup();
    const row = await screen.findByTestId('nav-coll-app-users');
    fireEvent.click(row, { metaKey: true });
    expect(onOpenCollection).toHaveBeenCalledWith(
      { connectionId: 'c1', dbName: 'app', collection: 'users' },
      { reuseExisting: false },
    );
  });

  it('alt-click opens an aggregation tab', async () => {
    const { onOpenCollection, onOpenAggregation } = setup();
    const row = await screen.findByTestId('nav-coll-app-users');
    fireEvent.click(row, { altKey: true });
    expect(onOpenAggregation).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'app',
      collection: 'users',
    });
    expect(onOpenCollection).not.toHaveBeenCalled();
  });
});
