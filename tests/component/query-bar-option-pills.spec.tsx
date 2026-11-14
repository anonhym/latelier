import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import {
  act,
  render,
  fireEvent,
  screen,
  waitFor,
  within,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';
import type { BuilderState, CollectionTabState } from '@shared/types';

/**
 * W05 §9.2 — the query's options are pills in the Filter Bar row, each opening
 * a popover with that option's editor. The grid the row replaces is still
 * there, per tab, behind "Keep options expanded".
 */

const b = (over: Partial<BuilderState> = {}): BuilderState => ({
  projection: [],
  sort: '',
  limit: '',
  ...over,
});

function makeState(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: b(),
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...over,
  };
}

/**
 * Holds the tab state the way the Workspace does: each patch is merged and
 * comes back as props. A pill's label, the grid and the Run gate only move
 * once the patch has made that round trip. `tabs` maps a tab id to its state,
 * so a test can switch tabs under a bar that stays mounted, as the app does.
 */
function Bars({
  tabs,
  tabId,
  actions,
}: {
  tabs: Record<string, CollectionTabState>;
  tabId: string;
  actions: CollectionWorkspaceActions;
}) {
  const [states, setStates] = React.useState(tabs);
  const live = React.useMemo<CollectionWorkspaceActions>(
    () => ({
      ...actions,
      patch: (patch) => {
        actions.patch(patch);
        setStates((prev) => ({ ...prev, [tabId]: { ...prev[tabId]!, ...patch } }));
      },
    }),
    [actions, tabId],
  );
  return (
    <CollectionWorkspaceProvider state={states[tabId]!} actions={live} meta={emptyWorkspaceMeta({ tabId })}>
      <QueryBar suggestionContext={null} />
    </CollectionWorkspaceProvider>
  );
}

function renderBar(state: CollectionTabState = makeState(), actions = emptyWorkspaceActions()) {
  const utils = render(<Bars tabs={{ t1: state }} tabId="t1" actions={actions} />);
  return { ...utils, actions };
}

const pill = (key: string) => screen.getByTestId(`option-pill-${key}`);
const queryPill = (key: string) => screen.queryByTestId(`option-pill-${key}`);
const row = () => within(screen.getByTestId('filter-bar-row'));

async function openMore() {
  fireEvent.click(screen.getByTestId('query-bar-more'));
  return within(await screen.findByRole('menu'));
}

describe('Filter Bar row — option pills', () => {
  it('draws Sort, Project and Limit as pills and keeps the rest in More', async () => {
    renderBar();
    expect(row().getByRole('button', { name: 'Sort' }).getAttribute('data-status')).toBe('unset');
    expect(row().getByRole('button', { name: 'Project' })).toBeTruthy();
    expect(row().getByRole('button', { name: 'Limit' })).toBeTruthy();
    for (const key of ['skip', 'collation', 'hint', 'maxTimeMS', 'readPreference']) {
      expect(queryPill(key)).toBeNull();
    }

    const menu = await openMore();
    expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Skip',
      'Collation',
      'Hint',
      'Max time',
      'Read preference',
    ]);
    expect(menu.getByRole('menuitemcheckbox', { name: 'Keep options expanded' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('says each set option on its pill, and promotes one out of More', () => {
    renderBar(
      makeState({
        builder: b({ sort: '{"createdAt":-1}', limit: '100', hint: '_id_', projection: ['a', 'b'] }),
        page: 2,
      }),
    );
    expect(pill('sort').textContent).toBe('Sort: createdAt ↓');
    expect(pill('sort').getAttribute('data-status')).toBe('set');
    expect(pill('project').textContent).toContain('Project: 2 fields');
    expect(pill('limit').textContent).toBe('Limit: 100');
    expect(pill('skip').textContent).toBe('Skip: 100');
    expect(pill('hint').textContent).toBe('Hint: _id_');
    expect(queryPill('collation')).toBeNull();
  });

  it('opens the option\'s own editor, named by the option and holding the focus', async () => {
    renderBar();
    fireEvent.click(pill('sort'));

    const editor = await screen.findByTestId('query-bar-sort');
    expect(screen.getByRole('textbox', { name: 'Sort' })).toBe(editor);
    expect(document.activeElement).toBe(editor);
  });

  it('writes what is typed to the query, and the pill says it', async () => {
    const { actions } = renderBar();
    fireEvent.click(pill('limit'));
    const editor = await screen.findByTestId('query-bar-limit');
    fireEvent.change(editor, { target: { value: '25' } });

    expect(actions.patch).toHaveBeenLastCalledWith({ builder: b({ limit: '25' }) });
    expect(pill('limit').textContent).toBe('Limit: 25');
    expect(pill('limit').getAttribute('data-status')).toBe('set');
  });

  it('closes on Escape and gives the focus back to its pill', async () => {
    renderBar();
    fireEvent.click(pill('sort'));
    const editor = await screen.findByTestId('query-bar-sort');

    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('query-bar-sort')).toBeNull());
    expect(document.activeElement).toBe(pill('sort'));
  });

  it('does not let Escape or Enter in its editor reach a handler around the bar', async () => {
    const onKeyDown = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <Bars tabs={{ t1: makeState() }} tabId="t1" actions={emptyWorkspaceActions()} />
      </div>,
    );
    fireEvent.click(pill('limit'));
    fireEvent.keyDown(await screen.findByTestId('query-bar-limit'), { key: 'Escape' });
    fireEvent.click(pill('limit'));
    fireEvent.keyDown(await screen.findByTestId('query-bar-limit'), { key: 'Enter' });

    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('closes on Enter without running, and runs on ⌘↵ with the value just typed', async () => {
    const { actions } = renderBar();
    fireEvent.click(pill('sort'));
    fireEvent.change(await screen.findByTestId('query-bar-sort'), { target: { value: '{ a: 1 }' } });
    fireEvent.keyDown(screen.getByTestId('query-bar-sort'), { key: 'Enter' });
    await waitFor(() => expect(screen.queryByTestId('query-bar-sort')).toBeNull());
    expect(actions.run).not.toHaveBeenCalled();

    fireEvent.click(pill('limit'));
    fireEvent.change(await screen.findByTestId('query-bar-limit'), { target: { value: '5' } });
    fireEvent.keyDown(screen.getByTestId('query-bar-limit'), { key: 'Enter', metaKey: true });
    expect(actions.run).toHaveBeenCalledTimes(1);
    expect(actions.run).toHaveBeenCalledWith({
      queryRaw: '{}',
      builder: b({ sort: '{ "a": 1 }', limit: '5' }),
    });
  });

  it('opens an option picked from More as a pill with its editor', async () => {
    renderBar();
    const menu = await openMore();
    fireEvent.click(menu.getByRole('menuitem', { name: 'Hint' }));

    const editor = await screen.findByTestId('query-bar-hint');
    expect(screen.getByRole('textbox', { name: 'Hint' })).toBe(editor);
    expect(pill('hint').textContent).toBe('Hint');
    await waitFor(() => expect(document.activeElement).toBe(editor));
  });

  it('marks an option that cannot run on its pill and on Run', async () => {
    renderBar(makeState({ builder: b({ collation: '{"locale"' }) }));
    expect(pill('collation').textContent).toBe('Collation: invalid');
    expect(pill('collation').getAttribute('data-status')).toBe('invalid');

    const run = screen.getByTestId('query-run-btn') as HTMLButtonElement;
    expect(run.textContent).toBe('Fix collation to run');
    expect(run.disabled).toBe(true);
  });

  it('shows the tab in front: its pills, and never another tab\'s open editor', async () => {
    const tabs = {
      tA: makeState(),
      tB: makeState({ builder: b({ sort: '{"name":1}', readPreference: 'secondary' }) }),
    };
    const actions = emptyWorkspaceActions();
    const { rerender } = render(<Bars tabs={tabs} tabId="tA" actions={actions} />);
    fireEvent.click(pill('limit'));
    await screen.findByTestId('query-bar-limit');

    rerender(<Bars tabs={tabs} tabId="tB" actions={actions} />);
    expect(screen.queryByTestId('query-bar-limit')).toBeNull();
    expect(pill('sort').textContent).toBe('Sort: name ↑');
    expect(pill('readPreference').textContent).toBe('Read preference: secondary');

    rerender(<Bars tabs={tabs} tabId="tA" actions={actions} />);
    expect(pill('sort').textContent).toBe('Sort');
    expect(queryPill('readPreference')).toBeNull();
  });
});

describe('Filter Bar row — Keep options expanded', () => {
  const grid = (container: HTMLElement) => container.querySelector('#query-bar-advanced');

  it('is off by default: no grid', () => {
    const { container } = renderBar();
    expect(grid(container)).toBeNull();
  });

  it('stores the choice on the tab and swaps the pills for the grid', async () => {
    const { container, actions } = renderBar(makeState({ builder: b({ sort: '{"a":1}' }) }));
    const menu = await openMore();
    fireEvent.click(menu.getByRole('menuitemcheckbox', { name: 'Keep options expanded' }));

    expect(actions.patch).toHaveBeenCalledWith({ optionsExpanded: true });
    const region = grid(container) as HTMLElement;
    expect(region).not.toBeNull();
    for (const id of ['sort', 'skip', 'limit', 'collation', 'hint', 'maxtime', 'readpref']) {
      expect(within(region).getByTestId(`query-bar-${id}`)).toBeTruthy();
    }
    expect((within(region).getByTestId('query-bar-sort') as HTMLInputElement).value).toBe('{"a":1}');
    // The grid holds every option but the projection, which stays a pill.
    expect(queryPill('sort')).toBeNull();
    expect(queryPill('limit')).toBeNull();
    expect(pill('project')).toBeTruthy();
  });

  it('lists only the toggle in More while on, checked, and turns back off', async () => {
    const { container, actions } = renderBar(makeState({ optionsExpanded: true }));
    const menu = await openMore();
    expect(menu.queryAllByRole('menuitem')).toHaveLength(0);
    const toggle = menu.getByRole('menuitemcheckbox', { name: 'Keep options expanded' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(actions.patch).toHaveBeenCalledWith({ optionsExpanded: false });
    expect(grid(container)).toBeNull();
    expect(pill('sort')).toBeTruthy();
  });

  it('is per tab', () => {
    const tabs = { tA: makeState({ optionsExpanded: true }), tB: makeState() };
    const actions = emptyWorkspaceActions();
    const { container, rerender } = render(<Bars tabs={tabs} tabId="tA" actions={actions} />);
    expect(grid(container)).not.toBeNull();

    rerender(<Bars tabs={tabs} tabId="tB" actions={actions} />);
    expect(grid(container)).toBeNull();
    expect(pill('sort')).toBeTruthy();
  });

  it('edits the same value from the grid as from the pill', () => {
    const { container, actions } = renderBar(makeState({ optionsExpanded: true }));
    const limit = within(grid(container) as HTMLElement).getByTestId('query-bar-limit');
    act(() => {
      fireEvent.change(limit, { target: { value: '7' } });
    });
    expect(actions.patch).toHaveBeenLastCalledWith({ builder: b({ limit: '7' }) });
  });
});
