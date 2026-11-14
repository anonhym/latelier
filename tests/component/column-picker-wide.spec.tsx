import { describe, it, expect, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { FieldsControl } from '../../src/pages/Workspace/FieldsControl';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';
import * as columnScroll from '../../src/pages/Workspace/views/columnScroll';

function state(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: [{ _id: 1, apple: 'a', banana: 'b', cherry: 'c' }],
      durationMs: 1,
      ranAt: '2026-01-01T00:00:00Z',
    },
    ...overrides,
  };
}

function renderPicker(s: CollectionTabState = state()) {
  const parentKeyDown = vi.fn();
  render(
    <div onKeyDown={parentKeyDown}>
      <CollectionWorkspaceProvider state={s} actions={emptyWorkspaceActions()} meta={emptyWorkspaceMeta()}>
        <FieldsControl />
      </CollectionWorkspaceProvider>
    </div>,
  );
  return { parentKeyDown };
}

describe('the column picker on a wide collection', () => {
  it('opens on a click with focus in its find box, so Escape closes it and nothing behind sees the key', async () => {
    const user = userEvent.setup();
    const { parentKeyDown } = renderPicker();
    const trigger = screen.getByRole('button', { name: /^project/i });

    await user.click(trigger);
    const find = await screen.findByRole('textbox', { name: 'Find a field' });
    await waitFor(() => expect(document.activeElement).toBe(find));
    parentKeyDown.mockClear();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Find a field' })).toBeNull());
    expect(parentKeyDown).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('typing narrows the list to the matching fields, case-insensitively', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole('button', { name: /^project/i }));

    await user.type(await screen.findByRole('textbox', { name: 'Find a field' }), 'AN');

    expect(screen.getByRole('checkbox', { name: 'banana' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'apple' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'cherry' })).toBeNull();
  });

  it('says so when nothing matches, and the filter is forgotten on close', async () => {
    const user = userEvent.setup();
    renderPicker();
    const trigger = screen.getByRole('button', { name: /^project/i });
    await user.click(trigger);

    await user.type(await screen.findByRole('textbox', { name: 'Find a field' }), 'zzz');
    expect(screen.getByText('No field matches')).toBeTruthy();
    await user.keyboard('{Escape}');
    await user.click(trigger);

    expect((await screen.findByRole('textbox', { name: 'Find a field' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('checkbox', { name: 'apple' })).toBeTruthy();
  });

  it('Enter scrolls the first match into view, and a row\'s own button scrolls that column', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(columnScroll, 'requestColumnScroll');
    renderPicker();
    await user.click(screen.getByRole('button', { name: /^project/i }));

    const find = await screen.findByRole('textbox', { name: 'Find a field' });
    await user.type(find, 'ch{Enter}');
    expect(spy).toHaveBeenLastCalledWith('cherry');

    await user.click(screen.getByRole('button', { name: 'Scroll to cherry' }));
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('keeps reordering against the full list while filtered', async () => {
    const user = userEvent.setup();
    const patchWith = vi.fn();
    render(
      <CollectionWorkspaceProvider
        state={state()}
        actions={emptyWorkspaceActions({ patchWith })}
        meta={emptyWorkspaceMeta()}
      >
        <FieldsControl />
      </CollectionWorkspaceProvider>,
    );
    await user.click(screen.getByRole('button', { name: /^project/i }));
    await user.type(await screen.findByRole('textbox', { name: 'Find a field' }), 'cherry');

    await user.click(screen.getByRole('button', { name: 'Move cherry up' }));

    const fn = patchWith.mock.calls[0]![0] as (s: CollectionTabState) => Partial<CollectionTabState>;
    expect(fn(state()).columnConfig?.order).toEqual(['_id', 'apple', 'cherry', 'banana']);
  });
});

function renderWideTable(order?: string[]) {
  return render(
    <CollectionWorkspaceProvider
      state={state()}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta()}
    >
      <TableView
        documents={[{ _id: 1, apple: 'a', banana: 'b', cherry: 'c' }]}
        onColumnResize={vi.fn()}
        onRowExpand={vi.fn()}
        columnConfig={order ? { order } : undefined}
      />
    </CollectionWorkspaceProvider>,
  );
}

describe('the Table on a wide collection', () => {
  it('pins _id: header and cells follow the horizontal scroll', () => {
    renderWideTable();
    const scroller = screen.getByTestId('table-scroll-container');
    const idCell = () => document.querySelector<HTMLElement>('[data-cell-key$=":_id"]')!;
    const idHeader = () => screen.getByTestId('table-header-_id');
    expect(idCell().style.transform).toBe('translateX(0px)');

    Object.defineProperty(scroller, 'scrollLeft', { value: 120, configurable: true });
    fireEvent.scroll(scroller);

    return waitFor(() => {
      expect(idCell().style.transform).toBe('translateX(120px)');
      expect(idHeader().style.transform).toBe('translateX(120px)');
      expect(idCell().style.zIndex).toBe('1');
    });
  });

  it('pins nothing else, and nothing when _id is no longer the first column', () => {
    renderWideTable(['apple', '_id', 'banana', 'cherry']);

    for (const cell of document.querySelectorAll<HTMLElement>('[data-cell-key]')) {
      expect(cell.style.transform).toBe('');
    }
  });

  it('a column scroll request brings a far column into view, clear of the pinned _id', () => {
    renderWideTable();
    const scroller = screen.getByTestId('table-scroll-container');
    Object.defineProperty(scroller, 'clientWidth', { value: 600, configurable: true });
    scroller.scrollLeft = 0;

    columnScroll.requestColumnScroll('cherry');

    // gutter 54 + _id 200 + two 160px columns → cherry spans 574..734; the actions
    // column covers the last 92px of the 600px viewport, so its right edge
    // must clear 508.
    expect(scroller.scrollLeft).toBe(734 - 508);
  });

  it('ignores a request for a column that is not drawn', () => {
    renderWideTable();
    const scroller = screen.getByTestId('table-scroll-container');
    scroller.scrollLeft = 33;

    columnScroll.requestColumnScroll('nope');

    expect(scroller.scrollLeft).toBe(33);
  });

  it('shows nothing from the picker inside the grid itself', () => {
    renderWideTable();
    expect(within(screen.getByRole('grid')).queryByRole('textbox', { name: 'Find a field' })).toBeNull();
  });
});
