import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '../helpers/render';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

function makeState(): CollectionTabState {
  return {
    view: 'Tree',
    builder: {
      projection: [],
      sort: '',
      limit: '',
    },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: [{}],
      durationMs: 5,
      ranAt: new Date().toISOString(),
    },
  };
}

function renderBar(metaOverrides: Partial<CollectionWorkspaceMeta> = {}) {
  const actions: CollectionWorkspaceActions = {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
  };
  const meta: CollectionWorkspaceMeta = {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
    ...metaOverrides,
  };
  render(
    <CollectionWorkspaceProvider state={makeState()} actions={actions} meta={meta}>
      <ResultBar />
    </CollectionWorkspaceProvider>,
  );
  return { actions };
}

async function openOverflowMenu() {
  const trigger = await screen.findByLabelText('More result actions');
  fireEvent.click(trigger);
}

describe('ResultBar — delete-all-matching overflow action', () => {
  it('calls actions.openDeleteAll() when "Delete all matching…" is clicked (writable provider)', async () => {
    const { actions } = renderBar();
    await openOverflowMenu();
    const item = await screen.findByRole('menuitem', { name: /Delete all matching/ });
    fireEvent.click(item);
    expect(actions.openDeleteAll).toHaveBeenCalledTimes(1);
  });

  it('does not offer delete-all in a read-only provider', () => {
    renderBar({ isReadOnly: true });
    expect(screen.queryByLabelText('More result actions')).toBeNull();
  });
});
