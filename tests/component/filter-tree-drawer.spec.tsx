// W13 §11 — "filter-tree-drawer.spec.tsx: add / edit / remove / nest, each
// asserted through `queryRaw`." Covers the ticket's own criteria: nested
// groups at arbitrary depth, and drag-and-drop still appending a `$eq` cond.
//
// Assertions go through `queryRaw` (what `api.tabs.update` was actually
// called with) rather than internal component state — per the ticket's
// testing note, a test that only inspects rendered DOM structure can pass
// against a tree the printer would refuse to run.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { DRAGGED_FIELD_MIME } from '../../src/pages/Workspace/builder';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-04T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

function makeCollectionTab(state: CollectionTabState): WorkspaceTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state,
  };
}

const CONNECTION = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

/** Returns the most recent `queryRaw` written via `api.tabs.update`, if any. */
function lastWrittenQueryRaw(updateSpy: ReturnType<typeof vi.fn>): string | undefined {
  for (let i = updateSpy.mock.calls.length - 1; i >= 0; i--) {
    // `tabs.update(id, { state: patch })` — see shared/ipc.ts.
    const arg = updateSpy.mock.calls[i]?.[1] as { state?: Partial<CollectionTabState> } | undefined;
    const patch = arg?.state;
    if (patch && 'queryRaw' in patch) return patch.queryRaw;
  }
  return undefined;
}

function mountWith(state: CollectionTabState) {
  const findSpy = vi.fn<IpcApi['query']['find']>(async () => ({
    documents: [],
    durationMs: 3,
    hasMore: false,
  }));
  const updateSpy = vi.fn(async () => makeCollectionTab(state));

  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: { find: findSpy, count: async () => ({ count: 0 }) },
  });

  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, findSpy, updateSpy };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Filter drawer — add / edit / remove / nest through queryRaw (W13 §11)', () => {
  it('filling a fresh condition row writes the printed filter to queryRaw', async () => {
    const { updateSpy } = mountWith(makeState());

    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    const fieldInput = await screen.findByPlaceholderText('field');
    fireEvent.change(fieldInput, { target: { value: 'status' } });
    const valueInput = await screen.findByPlaceholderText('value');
    fireEvent.change(valueInput, { target: { value: 'paid' } });

    await waitFor(() => {
      expect(lastWrittenQueryRaw(updateSpy)).toBe('{"status":{"$eq":"paid"}}');
    });
  });

  it('removing a condition writes the printed filter (down to {})', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"status":{"$eq":"paid"}}' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove condition status' }));

    await waitFor(() => {
      expect(lastWrittenQueryRaw(updateSpy)).toBe('{}');
    });
  });

  it('nested groups render and edit at arbitrary depth', async () => {
    // {"$and":[{"a":{"$eq":1}},{"$or":[{"b":{"$eq":2}}]}]} — a top-level cond
    // alongside a nested OR group holding one cond.
    const { updateSpy } = mountWith(
      makeState({
        queryRaw: '{"$and":[{"a":{"$eq":1}},{"$or":[{"b":{"$eq":2}}]}]}',
      }),
    );

    // Both the root AND's condition and the nested OR group's condition
    // render — two field inputs, "a" and "b".
    await waitFor(() => {
      const fields = screen.getAllByPlaceholderText('field') as HTMLInputElement[];
      expect(fields.map((f) => f.value).sort()).toEqual(['a', 'b']);
    });

    // Editing the nested condition's value updates queryRaw, proving the
    // edit reached a node two levels deep, not just the root. Each CondRow
    // renders its field input immediately before its value input, in tree
    // order, so the field's index lines up with the value's index — both
    // conds here use `$eq`, so neither row skips its value input (§ CondRow
    // hides the value input only for `$exists`).
    const fields = screen.getAllByPlaceholderText('field') as HTMLInputElement[];
    const values = screen.getAllByPlaceholderText('value') as HTMLInputElement[];
    const nestedIndex = fields.findIndex((f) => f.value === 'b');
    expect(nestedIndex).toBeGreaterThanOrEqual(0);
    fireEvent.change(values[nestedIndex]!, { target: { value: '99' } });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      // §3a — a group with exactly one printable child prints as that child
      // (the nested $or's envelope drops since it now holds one cond, not
      // two); $nor is the only logic that always survives that collapse.
      expect(JSON.parse(raw!)).toEqual({
        $and: [{ a: { $eq: 1 } }, { b: { $eq: 99 } }],
      });
    });
  });

  it('adding a nested group via "Add group" then a condition inside it produces a nested filter', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"a":{"$eq":1}}' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Add group' }));
    // The nested group's own "Add condition" is the *second* one in the
    // document (root's is first).
    const addConditionButtons = await screen.findAllByRole('button', { name: 'Add condition' });
    expect(addConditionButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(addConditionButtons[addConditionButtons.length - 1]!);

    const fields = await screen.findAllByPlaceholderText('field');
    const pendingField = (fields as HTMLInputElement[]).find((f) => f.value === '')!;
    fireEvent.change(pendingField, { target: { value: 'b' } });
    const values = screen.getAllByPlaceholderText('value') as HTMLInputElement[];
    const pendingValue = values.find((v) => v.value === '')!;
    fireEvent.change(pendingValue, { target: { value: '2' } });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      // A fresh "+ Condition" row defaults to valType 'string' (§4/builder.ts
      // `emptyBuilder`-equivalent default), so the typed "2" prints as a
      // string, not a number, unless the user also changes the value type.
      expect(JSON.parse(raw!)).toEqual({ $and: [{ a: { $eq: 1 } }, { b: { $eq: '2' } }] });
    });
  });

  it('drag-and-drop of a result field still appends a $eq condition', async () => {
    const { updateSpy } = mountWith(makeState());

    const dropTarget = await screen.findByLabelText('Drop a field here to add a condition');
    const dataTransfer = {
      types: [DRAGGED_FIELD_MIME],
      getData: (type: string) =>
        type === DRAGGED_FIELD_MIME ? JSON.stringify({ field: 'sku', value: 'apple-001' }) : '',
    };

    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ sku: { $eq: 'apple-001' } });
    });
  });

  // The string-value drop above doesn't exercise `condFromDragged`'s other
  // valType branches (builder.ts) — each has its own value-string encoding,
  // so a regression in one wouldn't fail that test. Cover the EJSON-sentinel
  // branches here.
  it('drag-and-drop of an ObjectId field appends a $eq condition with the hex value', async () => {
    const { updateSpy } = mountWith(makeState());

    const dropTarget = await screen.findByLabelText('Drop a field here to add a condition');
    const dataTransfer = {
      types: [DRAGGED_FIELD_MIME],
      getData: (type: string) =>
        type === DRAGGED_FIELD_MIME
          ? JSON.stringify({ field: '_id', value: { $oid: '507f1f77bcf86cd799439011' } })
          : '',
    };

    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ _id: { $eq: { $oid: '507f1f77bcf86cd799439011' } } });
    });
  });

  it('drag-and-drop of a Date field appends a $eq condition with the ISO value', async () => {
    const { updateSpy } = mountWith(makeState());

    const dropTarget = await screen.findByLabelText('Drop a field here to add a condition');
    const dataTransfer = {
      types: [DRAGGED_FIELD_MIME],
      getData: (type: string) =>
        type === DRAGGED_FIELD_MIME
          ? JSON.stringify({ field: 'createdAt', value: { $date: '2026-01-01T00:00:00.000Z' } })
          : '',
    };

    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ createdAt: { $eq: { $date: '2026-01-01T00:00:00.000Z' } } });
    });
  });

  it('drag-and-drop of a boolean field appends a $eq condition with the boolean value', async () => {
    const { updateSpy } = mountWith(makeState());

    const dropTarget = await screen.findByLabelText('Drop a field here to add a condition');
    const dataTransfer = {
      types: [DRAGGED_FIELD_MIME],
      getData: (type: string) =>
        type === DRAGGED_FIELD_MIME ? JSON.stringify({ field: 'active', value: true }) : '',
    };

    fireEvent.dragOver(dropTarget, { dataTransfer });
    fireEvent.drop(dropTarget, { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ active: { $eq: true } });
    });
  });
});
