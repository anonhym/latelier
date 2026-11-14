import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { clearUndoStore, recordUndo } from '../../src/pages/Workspace/undoStore';
import { offerUndo } from '../../src/pages/Workspace/offerUndo';
import { notify } from '../../src/theme/notifications';
import { undoFailureMessage } from '../../src/utils/auditUndo';
import type { CollectionTabState } from '@shared/types';

const NS = { connectionId: 'c1', dbName: 'app', collection: 'orders' };

function state(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [{ _id: 1, n: 1 }], durationMs: 1, ranAt: '2026-01-01T00:00:00.000Z' },
  };
}

function mount() {
  render(
    <CollectionWorkspaceProvider state={state()} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta(NS)}>
      <ResultViewer>
        <ResultViewer.Pagination />
        <input aria-label="Filter" />
        <ResultViewer.Body onClearFilter={() => {}} onColumnResize={() => {}} onRowExpand={() => {}} />
      </ResultViewer>
    </CollectionWorkspaceProvider>,
  );
}

function installUndo(result: () => Promise<unknown>) {
  const undo = vi.fn(result);
  installAtelierMock({ audit: { undo } as never });
  return undo;
}

const pressUndo = (el: Element) => fireEvent.keyDown(el, { key: 'z', metaKey: true });

afterEach(() => {
  act(() => clearUndoStore());
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('⌘Z on the results (X13 §13)', () => {
  it('runs the newest undo of this collection, then re-runs what showed the write', async () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    const onUndone = vi.fn();
    mount();
    act(() => {
      recordUndo(NS, { auditId: 'older', label: 'Undo: field updated', onUndone: vi.fn() });
      recordUndo(NS, { auditId: 'newest', label: 'Undo: document updated', onUndone });
    });
    pressUndo(screen.getByRole('tree', { name: 'Documents' }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith({ entryId: 'newest' }));
    await waitFor(() => expect(onUndone).toHaveBeenCalledOnce());
  });

  // A newer write with nothing to undo (an insert, a write over the capture
  // ceiling) is the last change now, so ⌘Z must not reverse the one before it.
  it('does nothing once a newer write on the collection recorded no undo', () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    act(() => {
      offerUndo('Field updated', 'older', () => {}, NS);
      offerUndo('Document inserted', undefined, () => {}, NS);
    });
    pressUndo(screen.getByRole('tree', { name: 'Documents' }));
    expect(undo).not.toHaveBeenCalled();
  });

  it('ignores another collection’s undo', () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    act(() => recordUndo({ ...NS, collection: 'users' }, { auditId: 'x', label: 'Undo: x', onUndone: vi.fn() }));
    pressUndo(screen.getByRole('tree', { name: 'Documents' }));
    expect(undo).not.toHaveBeenCalled();
  });

  it('in a text field stays the field’s own undo', () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    act(() => recordUndo(NS, { auditId: 'a', label: 'Undo: x', onUndone: vi.fn() }));
    const field = document.createElement('textarea');
    screen.getByRole('tree', { name: 'Documents' }).append(field);
    pressUndo(field);
    expect(undo).not.toHaveBeenCalled();
  });

  it('under a dialog belongs to the dialog', () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    act(() => recordUndo(NS, { auditId: 'a', label: 'Undo: x', onUndone: vi.fn() }));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const inside = document.createElement('button');
    dialog.append(inside);
    screen.getByRole('tree', { name: 'Documents' }).append(dialog);
    pressUndo(inside);
    expect(undo).not.toHaveBeenCalled();
  });
});

describe('Undo last change in `⋯`', () => {
  const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'More actions' }));

  it('is absent with nothing to undo, and names what it reverses once a write offered one', async () => {
    installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: /^Undo/ })).toBeNull();
    await userEvent.keyboard('{Escape}');

    act(() => offerUndo('Document updated', 'e1', () => {}, NS));
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /^Undo: document updated/ })).toBeTruthy();
  });

  it('is gone once it ran', async () => {
    const undo = installUndo(async () => ({ restored: 1, skipped: 0 }));
    mount();
    act(() => offerUndo('Document deleted', 'e2', () => {}, NS));
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Undo: document deleted/ }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith({ entryId: 'e2' }));
    await openMenu();
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /^Undo/ })).toBeNull());
  });

  it.each(['AUDIT_TARGET_CHANGED', 'AUDIT_ALREADY_UNDONE', 'AUDIT_UNDO_EXPIRED', 'AUDIT_NOT_REVERSIBLE', 'CONFLICT'])('a refused undo (%s) says why and removes the item', async (code) => {
    const refusal = Object.assign(new Error('gone'), { code });
    installUndo(async () => {
      throw refusal;
    });
    const error = vi.spyOn(notify, 'error');
    mount();
    act(() => offerUndo('Field updated', 'e3', () => {}, NS));
    pressUndo(screen.getByRole('tree', { name: 'Documents' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith(undoFailureMessage(refusal), { title: 'Undo failed' }));
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: /^Undo/ })).toBeNull();
  });

  // A dropped connection or a server error says nothing about the change
  // itself: the undo can still run once the Connection is back.
  it('a transient failure keeps the item, so it can be tried again', async () => {
    const lost = Object.assign(new Error('connection closed'), { code: 'MONGO_OP' });
    const undo = installUndo(async () => {
      throw lost;
    });
    const error = vi.spyOn(notify, 'error');
    mount();
    act(() => offerUndo('Field updated', 'e4', () => {}, NS));
    pressUndo(screen.getByRole('tree', { name: 'Documents' }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('connection closed', { title: 'Undo failed' }));
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /^Undo: field updated/ })).toBeTruthy();
    expect(undo).toHaveBeenCalledOnce();
  });
});
