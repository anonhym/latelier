import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
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

  // #57 — keyboard reorder path. orderedFields for baseState() is
  // ['_id', 'apple', 'banana'].

  it('exposes a Move up/down button pair per field, labelled with the field name', () => {
    const { getByRole } = renderChooser(baseState());
    fireEvent.click(getByRole('button', { name: /columns/i }));

    expect(getByRole('button', { name: 'Move apple up' })).toBeTruthy();
    expect(getByRole('button', { name: 'Move apple down' })).toBeTruthy();
  });

  it('disables the first field\'s "up" and the last field\'s "down", not just no-ops them', () => {
    const { getByRole } = renderChooser(baseState());
    fireEvent.click(getByRole('button', { name: /columns/i }));

    expect((getByRole('button', { name: 'Move _id up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((getByRole('button', { name: 'Move banana down' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((getByRole('button', { name: 'Move _id down' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((getByRole('button', { name: 'Move banana up' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  // Both directions reach `moveField` and produce the order the user asked
  // for. Parameterised rather than written out twice — two 15-line near-copies
  // is what took SonarCloud's new-duplication gate to 12.7% here, the same
  // shape that blocked #56.
  const MOVE_CASES: ReadonlyArray<{ button: string; order: string[] }> = [
    { button: 'Move _id down', order: ['apple', '_id', 'banana'] },
    { button: 'Move banana up', order: ['_id', 'banana', 'apple'] },
  ];

  MOVE_CASES.forEach(({ button, order }) => {
    it(`"${button}" patches the order to ${order.join(', ')}`, () => {
      const patchWith = vi.fn();
      const state = baseState();
      const { getByRole } = renderChooser(state, { patchWith });
      fireEvent.click(getByRole('button', { name: /columns/i }));

      fireEvent.click(getByRole('button', { name: button }));

      expect(patchWith).toHaveBeenCalledTimes(1);
      const fn = patchWith.mock.calls[0][0] as (
        s: CollectionTabState,
      ) => Partial<CollectionTabState>;
      expect(fn(state).columnConfig?.order).toEqual(order);
    });
  });

  it('announces the move outcome via a polite live region', async () => {
    const patchWith = vi.fn();
    const state = baseState();
    const { getByRole, getByText } = renderChooser(state, { patchWith });
    fireEvent.click(getByRole('button', { name: /columns/i }));

    await userEvent.click(getByRole('button', { name: 'Move apple down' }));

    expect(getByText(/apple moved to position 3 of 3/i)).toBeTruthy();
  });

  // Applies a mocked patchWith's captured updater to `state` and re-renders
  // with the result — the two focus-trap tests below both need a *real*
  // reorder committed to props, since ColumnChooser derives order from
  // props alone and the mocked patchWith never updates anything on its own.
  function rerenderAfterMove(
    ctx: ReturnType<typeof renderChooser>,
    state: CollectionTabState,
    patchWith: ReturnType<typeof vi.fn>,
  ) {
    const fn = patchWith.mock.calls[patchWith.mock.calls.length - 1][0] as (
      s: CollectionTabState,
    ) => Partial<CollectionTabState>;
    const nextState = { ...state, ...fn(state) };
    ctx.rerender(
      <CollectionWorkspaceProvider state={nextState} actions={ctx.actions} meta={baseMeta()}>
        <ColumnChooser />
      </CollectionWorkspaceProvider>,
    );
  }

  it('is operable with the keyboard alone: Tab reaches the buttons and Enter moves repeatedly', async () => {
    // Acceptance criterion 1 is "every field can be moved up and down with
    // the keyboard alone", and every other test here drives the buttons with
    // a click. #20 shipped a critical focus defect precisely because all 48
    // of its tests used the wrong event, so this one uses only keys: Tab to
    // reach the control, Enter to press it, and a *second* Enter without
    // re-focusing — which only works if the focus redirect leaves the user
    // standing on a button that still moves the same field.
    const patchWith = vi.fn();
    const state = baseState();
    const ctx = renderChooser(state, { patchWith });
    fireEvent.click(ctx.getByRole('button', { name: /columns/i }));

    const target = ctx.getByRole('button', { name: 'Move _id down' });
    let reached = false;
    for (let i = 0; i < 12 && !reached; i += 1) {
      await userEvent.tab();
      reached = document.activeElement === target;
    }
    expect(reached).toBe(true);

    await userEvent.keyboard('{Enter}');
    expect(patchWith).toHaveBeenCalledTimes(1);
    rerenderAfterMove(ctx, state, patchWith);

    // _id is now at index 1 of ['apple', '_id', 'banana']. A second Enter
    // with no intervening Tab or click must move it again.
    const moved = { ...state, ...(patchWith.mock.calls[0][0] as
      (s: CollectionTabState) => Partial<CollectionTabState>)(state) };
    await userEvent.keyboard('{Enter}');
    expect(patchWith).toHaveBeenCalledTimes(2);
    const second = (patchWith.mock.calls[1][0] as
      (s: CollectionTabState) => Partial<CollectionTabState>)(moved);
    expect(second.columnConfig?.order).toEqual(['apple', 'banana', '_id']);
  });

  /**
   * The end-of-list focus trap. Pressing the button that carries a field to an
   * end disables that very button, and a disabled button cannot hold focus —
   * without a redirect `document.activeElement` really does become `<body>`
   * (verified by disabling the redirect and watching both cases redden), which
   * is the defect #55 and #70 fixed elsewhere.
   *
   * `pressed` and `keepsFocus` are named per case rather than derived, so the
   * fact that "up to the top hands focus to *down*" stays stated in the test
   * instead of being recomputed the same way the component computes it.
   */
  const FOCUS_CASES: ReadonlyArray<{ end: string; pressed: string; keepsFocus: string }> = [
    { end: 'top', pressed: 'Move apple up', keepsFocus: 'Move apple down' },
    { end: 'bottom', pressed: 'Move apple down', keepsFocus: 'Move apple up' },
  ];

  FOCUS_CASES.forEach(({ end, pressed, keepsFocus }) => {
    it(`moving a field to the ${end} leaves focus on "${keepsFocus}", never on <body>`, async () => {
      const patchWith = vi.fn();
      const state = baseState();
      const ctx = renderChooser(state, { patchWith });
      fireEvent.click(ctx.getByRole('button', { name: /columns/i }));

      await userEvent.click(ctx.getByRole('button', { name: pressed }));
      rerenderAfterMove(ctx, state, patchWith);

      expect(document.activeElement).toBe(ctx.getByRole('button', { name: keepsFocus }));
      expect(document.activeElement).not.toBe(document.body);
    });
  });
});
