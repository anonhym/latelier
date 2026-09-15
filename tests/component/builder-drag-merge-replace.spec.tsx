// Merge/replace on drop onto an existing condition row, end-to-end through
// real DOM drag events. `mergeOrReplaceDragged` itself is unit-tested in
// `tests/unit/builder-drag-drop.spec.ts`; this file covers the row-level
// `onDragOver`/`onDrop` wiring in `BuilderPane.tsx` — that a drop landing
// exactly on a row is intercepted before it bubbles to the parent
// `GroupView`'s insert-a-sibling handler, across one and two levels of
// nesting, and that it's inert under `readOnly`.
//
// Every drop below is dispatched on a descendant *inside* the row that
// carries no drag handler of its own (the field `TextInput`, or the raw
// clause `textarea`) — never on the row's own wrapper div directly. That
// mirrors `builder-drag-nested-groups.spec.tsx`'s own component tests, "a
// drop on the innermost of several nested levels...": the row wrapper is
// almost entirely covered by its children in the real app, so a test that
// only ever dispatches on the wrapper itself would pass even if
// `stopPropagation()` were missing and the drop actually bubbled past the
// row to the parent group.
//
// Mount/mock/dataTransfer helpers mirror
// `tests/component/builder-drag-nested-groups.spec.tsx` and the
// read-only-freeze trigger mirrors
// `tests/component/filter-tree-print-failure.spec.tsx`.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { DRAGGED_FIELD_MIME } from '../../src/pages/Workspace/builder';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-20T12:00:00.000Z';

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

function dataTransferFor(field: string, value: unknown) {
  return {
    types: [DRAGGED_FIELD_MIME],
    getData: (type: string) =>
      type === DRAGGED_FIELD_MIME ? JSON.stringify({ field, value }) : '',
  };
}

/**
 * The real drag source fires this on `document` when a drag operation ends
 * for any reason — dropped, cancelled, dragged outside the window.
 * `FilterDrawer` listens for it at the document level as the single "clear
 * every level's highlight" signal.
 */
function fireDragEnd() {
  fireEvent(document, new Event('dragend', { bubbles: true }));
}

/** The row wrapper div carrying `data-row-path` — checked for presence/highlight, never for the drop itself. */
function rowEl(path: string): HTMLElement {
  const el = document.querySelector(`[data-row-path="${path}"]`);
  if (!el) throw new Error(`no row rendered at path "${path}"`);
  return el as HTMLElement;
}

/** A CondRow's field `TextInput` — has no drag handler of its own; a drop dispatched here must bubble through the row wrapper to be caught. */
function rowFieldInput(path: string): HTMLElement {
  const input = rowEl(path).querySelector('input[placeholder="field"]');
  if (!input) throw new Error(`no field input in row at path "${path}"`);
  return input as HTMLElement;
}

/** A RawRow's clause `textarea` — same "no handler of its own" property as `rowFieldInput`, for the raw-row case. */
function rowRawTextarea(path: string): HTMLElement {
  const el = rowEl(path).querySelector('textarea');
  if (!el) throw new Error(`no raw textarea in row at path "${path}"`);
  return el as HTMLElement;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe(' merge/replace on drop onto an existing row', () => {
  it('same field, bare $eq row → merges into an $in list instead of adding a sibling', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"status":{"$eq":"active"}}' }));
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('status', 'archived');
    fireEvent.dragOver(rowFieldInput('0'), { dataTransfer });
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ status: { $in: ['active', 'archived'] } });
    });
  });

  it('same field, existing $in row → extends the list', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"status":{"$in":["active","archived"]}}' }),
    );
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('status', 'pending');
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ status: { $in: ['active', 'archived', 'pending'] } });
    });
  });

  it('dropping a value already in the list is a true no-op — nothing is committed', async () => {
    // The merged array is unchanged, so it prints to the same text as
    // before — the drawer's own §5.4 no-op-commit skip (same one "+
    // Condition" on an already-blank pending row relies on) means
    // `onCommit`/`tabs.update` never fires at all, not just "fires with the
    // same value".
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"status":{"$in":["active","archived"]}}' }),
    );
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('status', 'active');
    fireEvent.dragOver(rowFieldInput('0'), { dataTransfer });
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await new Promise((r) => setTimeout(r, 350));
    expect(lastWrittenQueryRaw(updateSpy)).toBeUndefined();
  });

  it('different field dropped on a row → replaces field/value rather than adding a sibling', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"status":{"$eq":"active"}}' }));
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('name', 'bob');
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ name: { $eq: 'bob' } });
    });
  });

  it('same field but an unmergeable op ($gt) → replaces rather than merging', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"age":{"$gt":18}}' }));
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('age', 25);
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ age: { $eq: 25 } });
    });
  });

  it('drop onto a non-empty raw-clause row asks for confirmation, then replaces it with a fresh structured condition', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"a":{"$elemMatch":{"x":1}}}' }),
    );
    await screen.findByPlaceholderText('raw clause, e.g. {"items":{"$elemMatch":{"sku":1}}}');

    const dataTransfer = dataTransferFor('a', 5);
    fireEvent.drop(rowRawTextarea('0'), { dataTransfer });

    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }));

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ a: { $eq: 5 } });
    });
  });

  it('cancelling the raw-clause replace confirmation leaves the clause untouched', async () => {
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"a":{"$elemMatch":{"x":1}}}' }),
    );
    await screen.findByPlaceholderText('raw clause, e.g. {"items":{"$elemMatch":{"sku":1}}}');

    const dataTransfer = dataTransferFor('a', 5);
    fireEvent.drop(rowRawTextarea('0'), { dataTransfer });

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(lastWrittenQueryRaw(updateSpy)).toBeUndefined();
  });

  it('drop onto an empty raw-clause row replaces it without asking — nothing there to lose', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"a":{"$elemMatch":{"x":1}}}' }));
    await screen.findByPlaceholderText('raw clause, e.g. {"items":{"$elemMatch":{"sku":1}}}');
    fireEvent.change(rowRawTextarea('0'), { target: { value: '' } });

    const dataTransfer = dataTransferFor('a', 5);
    fireEvent.drop(rowRawTextarea('0'), { dataTransfer });

    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      expect(JSON.parse(raw!)).toEqual({ a: { $eq: 5 } });
    });
  });

  it('a drop landing on a row does not also insert a sibling in the parent group', async () => {
    // Two conditions under root $and; drop merges into the first only.
    const { updateSpy } = mountWith(
      makeState({ queryRaw: '{"$and":[{"status":{"$eq":"active"}},{"age":{"$gt":18}}]}' }),
    );
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('status', 'archived');
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      // Still exactly two clauses — the drop refined row 0, it did not add
      // a third sibling under root.
      expect(JSON.parse(raw!)).toEqual({
        $and: [{ status: { $in: ['active', 'archived'] } }, { age: { $gt: 18 } }],
      });
    });
  });

  it('a drop on a row nested two levels deep (inside an $or inside the root $and) still merges, not adds a sibling', async () => {
    // root $and > nested $or (path [1]) > cond `b` (path [1,0]) — the drop
    // has to beat two ancestor GroupViews' handlers, not just one.
    const queryRaw = '{"$and":[{"a":{"$eq":1}},{"$or":[{"b":{"$eq":2}}]}]}';
    const { updateSpy } = mountWith(makeState({ queryRaw }));
    await screen.findAllByPlaceholderText('field');

    const dataTransfer = dataTransferFor('b', 3);
    fireEvent.dragOver(rowFieldInput('1.0'), { dataTransfer });
    fireEvent.drop(rowFieldInput('1.0'), { dataTransfer });

    await waitFor(() => {
      const raw = lastWrittenQueryRaw(updateSpy);
      expect(raw).toBeDefined();
      // §3a — a group with exactly one printable child prints as that
      // child, so the nested $or's envelope drops once merged into `b`.
      expect(JSON.parse(raw!)).toEqual({ $and: [{ a: { $eq: 1 } }, { b: { $in: [2, 3] } }] });
    });
  });

  it('hovering a drag over a row highlights the row itself, not the parent group', async () => {
    // A row's own `stopPropagation()` claims a dragOver before it reaches
    // `GroupView` — without the row's own share of `activeDropPath`,
    // hovering a row would light up nothing at all, a silent regression of
    // a working affordance.
    mountWith(makeState({ queryRaw: '{"status":{"$eq":"active"}}' }));
    await screen.findAllByPlaceholderText('field');

    const root = document.querySelector('[data-group-path="root"]') as HTMLElement;
    const row = rowEl('0');
    const dataTransfer = dataTransferFor('c', 3);

    fireEvent.dragOver(rowFieldInput('0'), { dataTransfer });

    await waitFor(() => expect(row.style.background).not.toBe(''));
    // The root group's own dragOver handler never fired for that event.
    expect(root.style.background).toBe('');

    // The drag ending (dropped, cancelled, dragged outside the window) fires
    // `dragend` on the drag source, which `FilterDrawer` listens for at the
    // document level and clears the row's highlight along with every other
    // level (see `fireDragEnd`).
    fireDragEnd();
    await waitFor(() => expect(row.style.background).toBe(''));
  });

  it('dropping onto an existing condition does not leave the root group\'s highlight stuck', async () => {
    // The root's own highlight (lit while the pointer was over its plain
    // surface, on the way to the row) must not stay lit after a drop lands
    // on an existing row — a `dragLeave`-based guard is an easy way to get
    // that wrong once the row's own `stopPropagation()` claims the event.
    // `activeDropPath` is a single value shared by every level: the row's
    // own `onDragOver` overwrites it to the row's path, which un-highlights
    // root for free — there's no separate "leave" step left to get wrong.
    mountWith(makeState({ queryRaw: '{"status":{"$eq":"active"}}' }));
    await screen.findAllByPlaceholderText('field');

    const root = document.querySelector('[data-group-path="root"]') as HTMLElement;
    const fieldInput = rowFieldInput('0');
    const dataTransfer = dataTransferFor('status', 'archived');

    // The pointer starts over root's own surface (lighting root up), then
    // moves onto the existing row to drop there.
    fireEvent.dragOver(root, { dataTransfer });
    await waitFor(() => expect(root.style.background).not.toBe(''));

    fireEvent.dragOver(fieldInput, { dataTransfer });
    await waitFor(() => expect(root.style.background).toBe(''));

    fireEvent.drop(fieldInput, { dataTransfer });

    // Root's highlight must still be off after the drop — not just before it.
    expect(root.style.background).toBe('');
  });

  it('inert when the tree is frozen read-only', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"status":{"$eq":"active"}}' }));
    const fieldInput = (await screen.findByPlaceholderText('field')) as HTMLInputElement;
    expect(fieldInput.value).toBe('status');

    // §6a — invalid JSON in the bar freezes the drawer read-only on the last
    // valid tree, which keeps the row (and its `data-row-path`) rendered.
    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    fireEvent.change(bar, { target: { value: 'not valid json{{{' } });
    await screen.findByText(/isn't valid JSON/);
    expect(fieldInput).toHaveProperty('disabled', true);

    const dataTransfer = dataTransferFor('status', 'archived');
    fireEvent.dragOver(rowFieldInput('0'), { dataTransfer });
    fireEvent.drop(rowFieldInput('0'), { dataTransfer });

    await new Promise((r) => setTimeout(r, 0));
    // No commit carried a merged/replaced filter — the row-level handler's
    // readOnly guard blocked it, same invariant as the group-level handler.
    for (const call of updateSpy.mock.calls as unknown[][]) {
      const patch = (call[1] as { state?: Partial<CollectionTabState> } | undefined)?.state;
      if (patch && 'queryRaw' in patch) {
        expect(patch.queryRaw).not.toContain('archived');
      }
    }
  });
});
