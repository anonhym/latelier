import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceMeta } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

beforeEach(() => installAtelierMock());
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function renderBar(
  stateOverrides: Partial<CollectionTabState> = {},
  metaOverrides: Partial<CollectionWorkspaceMeta> = {},
) {
  const patch = vi.fn();
  const state: CollectionTabState = {
    view: 'JSON',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [{ _id: 1 }], durationMs: 1, ranAt: '2026-01-01T00:00:00Z' },
    ...stateOverrides,
  };
  render(
    <CollectionWorkspaceProvider
      state={state}
      actions={emptyWorkspaceActions({ patch })}
      meta={emptyWorkspaceMeta(metaOverrides)}
    >
      <ResultBar />
    </CollectionWorkspaceProvider>,
  );
  return { patch };
}

describe('ResultBar — JSON display toggle', () => {
  it('offers Canonical EJSON on the JSON view, unchecked by default, and switches the tab to it', async () => {
    const { patch } = renderBar();
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));

    const item = await screen.findByRole('menuitemcheckbox', { name: 'Canonical EJSON', checked: false });
    fireEvent.click(item);

    expect(patch).toHaveBeenCalledWith({ jsonDisplay: 'canonical' });
  });

  it('is checked when the tab is canonical, and switches back to shell', async () => {
    const { patch } = renderBar({ jsonDisplay: 'canonical' });
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));

    const item = await screen.findByRole('menuitemcheckbox', { name: 'Canonical EJSON', checked: true });
    fireEvent.click(item);

    expect(patch).toHaveBeenCalledWith({ jsonDisplay: 'shell' });
  });

  it('is absent on the other views', () => {
    renderBar({ view: 'Table' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Canonical EJSON' })).toBeNull();
  });

  it('stays reachable on a read-only collection, with only the display group in it', async () => {
    renderBar({}, { isReadOnly: true });
    fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));

    expect(await screen.findByRole('menuitemcheckbox', { name: 'Canonical EJSON' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Export…/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Delete all/ })).toBeNull();
  });
});
