// W13 §11 — "filter-tree-drawer.spec.tsx: add / edit / remove / nest, each
// asserted through `queryRaw`." Covers the ticket's own criteria: nested
// groups at arbitrary depth, and drag-and-drop still appending a `$eq` cond.
//
// Assertions go through `queryRaw` (what `api.tabs.update` was actually
// called with) rather than internal component state — per the ticket's
// testing note, a test that only inspects rendered DOM structure can pass
// against a tree the printer would refuse to run.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { DRAGGED_FIELD_MIME } from '../../src/pages/Workspace/builder';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, GroupNode, WorkspaceTab } from '@shared/types';
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

/** The most recent patch that carried a `filterDraft` key, and that key's value. */
function lastWrittenDraft(
  updateSpy: ReturnType<typeof vi.fn>,
): { found: boolean; draft: CollectionTabState['filterDraft'] } {
  for (let i = updateSpy.mock.calls.length - 1; i >= 0; i--) {
    const arg = updateSpy.mock.calls[i]?.[1] as { state?: Partial<CollectionTabState> } | undefined;
    const patch = arg?.state;
    if (patch && 'filterDraft' in patch) return { found: true, draft: patch.filterDraft };
  }
  return { found: false, draft: undefined };
}

function fieldValues(): string[] {
  return (screen.queryAllByPlaceholderText('field') as HTMLInputElement[]).map((f) => f.value);
}

const A1 = { kind: 'cond', field: 'a', op: '$eq', valType: 'number', value: '1' } as const;
const B2 = { kind: 'cond', field: 'b', op: '$eq', valType: 'number', value: '2' } as const;

function andRoot(...children: GroupNode['children']): GroupNode {
  return { kind: 'group', logic: '$and', children };
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

describe('Filter drawer — switching a condition off (disable)', () => {
  it('unchecking a row drops it from queryRaw but keeps it on screen, and re-checking brings it back', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"$and":[{"a":{"$eq":1}},{"b":{"$eq":2}}]}' }),
    );

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Include condition b' }));

    await waitFor(() => expect(lastWrittenQueryRaw(updateSpy)).toBe('{"a":{"$eq":1}}'));
    expect(fieldValues()).toEqual(['a', 'b']);
    const box = screen.getByRole('checkbox', { name: 'Include condition b' }) as HTMLInputElement;
    expect(box.checked).toBe(false);

    const { draft } = lastWrittenDraft(updateSpy);
    expect(draft?.queryRaw).toBe('{"a":{"$eq":1}}');
    expect(draft?.root.children[1]).toMatchObject({ field: 'b', disabled: true });

    fireEvent.click(box);
    await waitFor(() =>
      expect(lastWrittenQueryRaw(updateSpy)).toBe('{"$and":[{"a":{"$eq":1}},{"b":{"$eq":2}}]}'),
    );
  });

  it('unchecking a nested group drops the whole group from queryRaw', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"$and":[{"a":{"$eq":1}},{"$or":[{"b":{"$eq":2}},{"c":{"$eq":3}}]}]}' }),
    );

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Include group' }));

    await waitFor(() => expect(lastWrittenQueryRaw(updateSpy)).toBe('{"a":{"$eq":1}}'));
    expect(fieldValues()).toEqual(['a', 'b', 'c']);
  });
});

describe('Filter drawer — the persisted draft', () => {
  it('seeds from a matching draft, so a switched-off row is still there', async () => {
    mountWith(
      makeState({
        queryRaw: '{"a":{"$eq":1}}',
        filterDraft: { queryRaw: '{"a":{"$eq":1}}', root: andRoot(A1, { ...B2, disabled: true }) },
      }),
    );

    const box = (await screen.findByRole('checkbox', { name: 'Include condition b' })) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(fieldValues()).toEqual(['a', 'b']);
  });

  it('ignores a draft written for other filter text', async () => {
    mountWith(
      makeState({
        queryRaw: '{"a":{"$eq":1}}',
        filterDraft: { queryRaw: '{"x":{"$eq":1}}', root: andRoot(A1, { ...B2, disabled: true }) },
      }),
    );

    await waitFor(() => expect(fieldValues()).toEqual(['a']));
  });

  it('ignores a draft whose tree prints to something other than queryRaw', async () => {
    mountWith(
      makeState({
        queryRaw: '{"a":{"$eq":1}}',
        // Same text recorded, but the tree itself prints {"$and":[a, b]}:
        // showing it would put a tree on screen that is not what runs.
        filterDraft: { queryRaw: '{"a":{"$eq":1}}', root: andRoot(A1, B2) },
      }),
    );

    await waitFor(() => expect(fieldValues()).toEqual(['a']));
  });

  it('a draft holding a row that cannot print comes back with its "not applied" banner', async () => {
    mountWith(
      makeState({
        queryRaw: '{"a":{"$eq":1}}',
        filterDraft: {
          queryRaw: '{"a":{"$eq":1}}',
          root: andRoot(A1, { kind: 'cond', field: 'n', op: '$eq', valType: 'number', value: 'abc' }),
        },
      }),
    );

    const values = (await screen.findAllByPlaceholderText('value')) as HTMLInputElement[];
    expect(values.map((v) => v.value)).toEqual(['1', 'abc']);
    expect(screen.getByRole('status').textContent).toContain('1 not applied: n');
  });

  it('Reset clears the draft along with the filter', async () => {
    const { updateSpy } = mountWith(
      makeState({
        queryRaw: '{}',
        filterDraft: { queryRaw: '{}', root: andRoot({ ...A1, disabled: true }) },
      }),
    );
    await waitFor(() => expect(fieldValues()).toEqual(['a']));

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Reset' })[0]!);

    await waitFor(() => expect(fieldValues()).toEqual([]));
    await waitFor(() => expect(lastWrittenDraft(updateSpy)).toEqual({ found: true, draft: undefined }));
  });
});

describe('Filter drawer — negation (NOT)', () => {
  it('Negate (NOT) wraps a condition in a one-child $nor shown as NOT, and Remove negation unwraps it', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"a":{"$eq":1}}' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Condition options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Negate (NOT)' }));

    await waitFor(() => expect(lastWrittenQueryRaw(updateSpy)).toBe('{"$nor":[{"a":{"$eq":1}}]}'));
    expect(screen.getByText('NOT')).toBeTruthy();
    // The NOT label replaces the logic picker on that group; only the root's is left.
    expect(screen.getAllByRole('radiogroup', { name: 'Group logic' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Remove negation' }));

    await waitFor(() => expect(lastWrittenQueryRaw(updateSpy)).toBe('{"a":{"$eq":1}}'));
    expect(screen.queryByText('NOT')).toBeNull();
    expect(fieldValues()).toEqual(['a']);
  });

  it('Negate group wraps a nested group in $nor', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"$and":[{"a":{"$eq":1}},{"$or":[{"b":{"$eq":2}},{"c":{"$eq":3}}]}]}' }),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Negate group' }));

    await waitFor(() =>
      expect(lastWrittenQueryRaw(updateSpy)).toBe(
        '{"$and":[{"a":{"$eq":1}},{"$nor":[{"$or":[{"b":{"$eq":2}},{"c":{"$eq":3}}]}]}]}',
      ),
    );
    // The new NOT wrapper offers no "Negate group" of its own; the $or inside it still does.
    expect(screen.getAllByRole('button', { name: 'Negate group' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove negation' })).toBeTruthy();
  });

  it('a second child turns a negation back into an ordinary NOR group', async () => {
    mountWith(makeState({ queryRaw: '{"$and":[{"a":{"$eq":1}},{"$nor":[{"b":{"$eq":2}}]}]}' }));

    await screen.findByText('NOT');
    const addButtons = screen.getAllByRole('button', { name: 'Add condition' });
    fireEvent.click(addButtons[addButtons.length - 1]!);

    await waitFor(() => expect(screen.queryByText('NOT')).toBeNull());
    expect(screen.getAllByRole('radiogroup', { name: 'Group logic' })).toHaveLength(2);
  });
});

describe('Filter drawer — insert a condition between rows', () => {
  const AB = '{"$and":[{"a":{"$eq":1}},{"b":{"$eq":2}}]}';

  it('Insert condition above puts a blank row before this one, focused, and leaves queryRaw alone', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: AB }));
    await waitFor(() => expect(fieldValues()).toEqual(['a', 'b']));
    const writesBefore = updateSpy.mock.calls.length;

    fireEvent.click(screen.getAllByRole('button', { name: 'Condition options' })[1]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert condition above' }));

    await waitFor(() => expect(fieldValues()).toEqual(['a', '', 'b']));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByPlaceholderText('field')[1]),
    );
    // The blank row is pending, so nothing new reaches queryRaw.
    await new Promise((r) => setTimeout(r, 300));
    const newPatches = (updateSpy.mock.calls as unknown[][])
      .slice(writesBefore)
      .map((c) => (c[1] as { state?: Partial<CollectionTabState> } | undefined)?.state ?? {});
    expect(newPatches.length).toBeGreaterThan(0);
    expect(newPatches.some((p) => 'queryRaw' in p)).toBe(false);
  });

  it('Insert condition below puts a blank row after this one, focused', async () => {
    mountWith(makeState({ queryRaw: AB }));
    await waitFor(() => expect(fieldValues()).toEqual(['a', 'b']));

    fireEvent.click(screen.getAllByRole('button', { name: 'Condition options' })[0]!);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert condition below' }));

    await waitFor(() => expect(fieldValues()).toEqual(['a', '', 'b']));
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getAllByPlaceholderText('field')[1]),
    );
  });

  it('a raw clause row offers the same inserts', async () => {
    mountWith(makeState({ queryRaw: '{"$and":[{"a":{"$eq":1}},{"items":{"$elemMatch":{"sku":1}}}]}' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Raw clause options' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Insert condition above' }));

    await waitFor(() => expect(fieldValues()).toEqual(['a', '']));
  });
});
