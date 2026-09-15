import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '../helpers/render';
import { ColumnChooser } from '../../src/pages/Workspace/ColumnChooser';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

function baseState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: [
        { _id: 1, apple: 'a', banana: 'b' },
        { _id: 2, apple: 'a2', banana: 'b2' },
      ],
      durationMs: 1,
      ranAt: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

function baseMeta(): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
  };
}

function renderChooser(
  state: CollectionTabState,
  actionOverrides: Partial<CollectionWorkspaceActions> = {},
) {
  const actions: CollectionWorkspaceActions = {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
    ...actionOverrides,
  };
  return {
    ...render(
      <CollectionWorkspaceProvider state={state} actions={actions} meta={baseMeta()}>
        <ColumnChooser />
      </CollectionWorkspaceProvider>,
    ),
    actions,
  };
}

describe('ColumnChooser', () => {
  it('toggling a field checkbox calls patchWith with the field added to hidden', () => {
    const patchWith = vi.fn();
    const { getByRole } = renderChooser(baseState(), { patchWith });

    // Open the popover.
    fireEvent.click(getByRole('button', { name: /columns/i }));

    const appleCheckbox = getByRole('checkbox', { name: 'apple' });
    fireEvent.click(appleCheckbox);

    expect(patchWith).toHaveBeenCalledTimes(1);
    const fn = patchWith.mock.calls[0][0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    const patch = fn(baseState());
    expect(patch.columnConfig?.hidden).toContain('apple');
  });

  it('unchecking an already-hidden field removes it from hidden', () => {
    const patchWith = vi.fn();
    const state = baseState({ columnConfig: { hidden: ['apple'] } });
    const { getByRole } = renderChooser(state, { patchWith });

    fireEvent.click(getByRole('button', { name: /columns/i }));
    const appleCheckbox = getByRole('checkbox', { name: 'apple' }) as HTMLInputElement;
    expect(appleCheckbox.checked).toBe(false);

    fireEvent.click(appleCheckbox);
    const fn = patchWith.mock.calls[0][0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    const patch = fn(state);
    expect(patch.columnConfig?.hidden).not.toContain('apple');
  });

  it('add-computed-column input is disabled for an empty/whitespace path', () => {
    const { getByRole } = renderChooser(baseState());
    fireEvent.click(getByRole('button', { name: /columns/i }));

    const addButton = getByRole('button', { name: /add column/i }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);

    const input = getByRole('textbox', { name: /computed column path/i });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(addButton.disabled).toBe(true);

    fireEvent.change(input, { target: { value: 'address.city' } });
    expect(addButton.disabled).toBe(false);
  });

  it('adding a computed column trims the path and calls patchWith', () => {
    const patchWith = vi.fn();
    const { getByRole } = renderChooser(baseState(), { patchWith });
    fireEvent.click(getByRole('button', { name: /columns/i }));

    const input = getByRole('textbox', { name: /computed column path/i });
    fireEvent.change(input, { target: { value: '  address.city  ' } });
    fireEvent.click(getByRole('button', { name: /add column/i }));

    expect(patchWith).toHaveBeenCalledTimes(1);
    const fn = patchWith.mock.calls[0][0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    const patch = fn(baseState());
    expect(patch.columnConfig?.computed).toEqual([
      expect.objectContaining({ path: 'address.city' }),
    ]);
  });

  it('adding a duplicate computed path is a no-op (de-duped)', () => {
    const patchWith = vi.fn();
    const state = baseState({
      columnConfig: { computed: [{ id: 'c1', path: 'address.city' }] },
    });
    const { getByRole } = renderChooser(state, { patchWith });
    fireEvent.click(getByRole('button', { name: /columns/i }));

    const input = getByRole('textbox', { name: /computed column path/i });
    fireEvent.change(input, { target: { value: 'address.city' } });
    const addButton = getByRole('button', { name: /add column/i }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });

  it('removing a computed column calls patchWith without it', () => {
    const patchWith = vi.fn();
    const state = baseState({
      columnConfig: { computed: [{ id: 'c1', path: 'address.city', label: 'City' }] },
    });
    const { getByRole } = renderChooser(state, { patchWith });
    fireEvent.click(getByRole('button', { name: /columns/i }));

    fireEvent.click(getByRole('button', { name: /remove city/i }));
    const fn = patchWith.mock.calls[0][0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    const patch = fn(state);
    expect(patch.columnConfig?.computed).toEqual([]);
  });

  it('renders "No fields available" when there are no documents yet', () => {
    const { getByRole, getByText } = renderChooser(baseState({ lastRun: undefined }));
    fireEvent.click(getByRole('button', { name: /columns/i }));
    expect(getByText(/no fields available/i)).toBeTruthy();
  });

  it('resets the drag index on dragEnd, so a later stray drop is a no-op', () => {
    // Review finding: `dragIndex.current` was only cleared on
    // `onDrop`. A drag cancelled without a drop (Escape, dropped outside a
    // valid target) left the stale index around for a later, unrelated drop
    // to consume. `onDragEnd` must clear it too.
    const patchWith = vi.fn();
    const { getByRole, getAllByTitle } = renderChooser(baseState(), { patchWith });
    fireEvent.click(getByRole('button', { name: /columns/i }));

    // orderedFields for baseState() is ['_id', 'apple', 'banana'].
    const handles = getAllByTitle(/drag to reorder/i);
    expect(handles).toHaveLength(3);

    fireEvent.dragStart(handles[0]);
    fireEvent.dragEnd(handles[0]);

    // A drop with no preceding dragStart for *this* gesture must not reorder.
    fireEvent.drop(handles[2]);

    expect(patchWith).not.toHaveBeenCalled();
  });
});
