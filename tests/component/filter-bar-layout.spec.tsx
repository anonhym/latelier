import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
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
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { _resetTabRequestsForTests, requestSavedRename } from '../../src/pages/Workspace/tabRequest';
import type { CollectionWorkspaceActions } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

/**
 * W05 §10 — the Filter Bar row's collapse steps and its split controls. jsdom
 * lays nothing out, which reads as room for everything (form 0); a narrower bar
 * is what `useElementWidth` would read, so a test stubs the bar's width.
 */

function makeState(over: Partial<CollectionTabState['builder']> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '', ...over },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

function Bar({ actions, tabId, initial }: { actions: CollectionWorkspaceActions; tabId: string; initial: CollectionTabState }) {
  const [state, setState] = React.useState(initial);
  const live = React.useMemo<CollectionWorkspaceActions>(
    () => ({
      ...actions,
      patch: (patch) => {
        actions.patch(patch);
        setState((prev) => ({ ...prev, ...patch }));
      },
      patchWith: (fn) => {
        actions.patchWith(fn);
        setState((prev) => ({ ...prev, ...fn(prev) }));
      },
    }),
    [actions],
  );
  return (
    <CollectionWorkspaceProvider state={state} actions={live} meta={emptyWorkspaceMeta({ tabId })}>
      <QueryBar suggestionContext={null} builderOpen onToggleBuilder={() => undefined} />
    </CollectionWorkspaceProvider>
  );
}

function renderBar(initial = makeState(), tabId = 't1') {
  const actions = emptyWorkspaceActions();
  const utils = render(<Bar actions={actions} tabId={tabId} initial={initial} />);
  return { ...utils, actions };
}

/** The bar's width, as `useElementWidth` reads it. */
const barWidth = (width: number) =>
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width } as DOMRect);

const queriesButton = () => screen.getByTestId('query-bar-saved-btn');
const openQueries = () => fireEvent.click(queriesButton());
const selectedTab = () =>
  within(screen.getByRole('dialog'))
    .getAllByRole('tab')
    .filter((t) => t.getAttribute('aria-selected') === 'true')
    .map((t) => t.textContent);

beforeEach(() => installAtelierMock());
afterEach(() => {
  vi.restoreAllMocks();
  _resetTabRequestsForTests();
  uninstallAtelierMock();
});

describe('Filter Bar row — the Builder toggle', () => {
  it('is an icon with its shortcut in its name, at every width', () => {
    renderBar();
    const labelled = screen.getByRole('button', { name: /^Builder \(.+\)$/ });
    expect(labelled.textContent).toBe('');
    expect(labelled.getAttribute('aria-pressed')).toBe('true');
    expect(labelled.hasAttribute('data-builder-toggle')).toBe(true);
  });
});

describe('Filter Bar row — the field box', () => {
  it('draws the filter in a bordered box with its fill', () => {
    renderBar();
    const box = screen.getByTestId('query-bar-filter-box');
    expect(box.style.border).toContain('1px solid');
    expect(box.style.border).toContain('--atelier-border-med');
    expect(box.style.background).toContain('--atelier-bg');
    expect(box.style.borderRadius).toBe('6px');
    expect(within(box).getByTestId('query-bar-input')).toBeTruthy();
    expect(within(box).getByTestId('query-bar-expand-btn')).toBeTruthy();
  });
});

describe('Filter Bar row — the attached option group', () => {
  it('holds Sort, Project, Limit and a More menu named for assistive tech', () => {
    renderBar();
    const group = screen.getByTestId('query-bar-options-group');
    expect(group.style.height).toBe('24px');
    expect(within(group).getByTestId('option-pill-sort')).toBeTruthy();
    expect(within(group).getByTestId('option-pill-project')).toBeTruthy();
    expect(within(group).getByTestId('option-pill-limit')).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'More options' })).toBe(screen.getByTestId('query-bar-more'));
  });
});

describe('Filter Bar row — the folded Options pill', () => {
  it('says Options alone while nothing is set, and counts the set options', () => {
    barWidth(1000);
    renderBar();
    expect(screen.getByTestId('query-bar-options-folded').textContent).toBe('Options');
    expect(screen.queryByTestId('option-pill-sort')).toBeNull();
    expect(screen.queryByTestId('query-bar-options-group')).toBeNull();
  });

  it('counts the set options, and holds the same form while they are set', () => {
    barWidth(1000);
    renderBar(makeState({ sort: '{"a":1}', limit: '5' }));
    expect(screen.getByTestId('query-bar-options-folded').textContent).toBe('Options · 2');
  });

  it('lists every option with its value, and the keep-expanded toggle', async () => {
    barWidth(1000);
    renderBar(makeState({ sort: '{"a":1}', limit: '5' }));
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual([
      'Sort: a ↑',
      'Project',
      'Limit: 5',
      'Skip',
      'Collation',
      'Hint',
      'Max time',
      'Read preference',
    ]);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Keep options expanded' })).toBeTruthy();
  });

  it('opens the picked option\'s editor under the folded pill and commits through the pill\'s path', async () => {
    barWidth(1000);
    const { actions } = renderBar(makeState({ limit: '5' }));
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Limit: 5' }));

    const editor = await screen.findByTestId('query-bar-limit');
    expect((editor as HTMLInputElement).value).toBe('5');
    fireEvent.change(editor, { target: { value: '7' } });
    expect(actions.patch).toHaveBeenLastCalledWith({ builder: expect.objectContaining({ limit: '7' }) });
    expect(screen.getByTestId('query-bar-options-folded').textContent).toBe('Options · 1');

    // Escape closes it, as it closes a pill's, and the focus returns to the folded pill.
    fireEvent.keyDown(editor, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('query-bar-limit')).toBeNull());
    expect(document.activeElement).toBe(screen.getByTestId('query-bar-options-folded'));
  });

  it('opens Project\'s own editor from the menu', async () => {
    barWidth(1000);
    renderBar();
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project' }));
    expect(await screen.findByTestId('fields-projection')).toBeTruthy();
  });

  it('closes an editor opened from the folded menu once the row unfolds, and does not reopen it at the next fold', async () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: ResizeObserverEntry[]) => void) {
          observers.push(() => cb([]));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const width = barWidth(1000);
    renderBar();
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project' }));
    expect(await screen.findByTestId('fields-projection')).toBeTruthy();

    const resize = (w: number) => {
      width.mockReturnValue({ width: w } as DOMRect);
      act(() => observers.forEach((fire) => fire()));
    };
    resize(1500);
    await waitFor(() => expect(screen.queryByTestId('fields-projection')).toBeNull());
    resize(1000);
    expect(screen.getByTestId('query-bar-options-folded')).toBeTruthy();
    expect(screen.queryByTestId('fields-projection')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('shows a refused Project draft on the folded pill and in its menu once the editor closes', async () => {
    barWidth(1000);
    renderBar();
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project' }));
    const input = (await screen.findByTestId('fields-projection')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '{a: }' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('fields-projection')).toBeNull());

    // The builder never saw the draft, so only the Project control knows it was refused.
    const folded = screen.getByTestId('query-bar-options-folded');
    expect(folded.getAttribute('data-status')).toBe('invalid');
    fireEvent.click(folded);
    const item = await screen.findByRole('menuitem', { name: 'Project: invalid' });
    expect(item.getAttribute('data-status')).toBe('invalid');
  });

  // The Project control is drawn in the pill group or under the folded pill,
  // so a resize across the fold swaps one for the other; its draft is the row's.
  const stubResize = () => {
    const observers: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: (entries: ResizeObserverEntry[]) => void) {
          observers.push(() => cb([]));
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const width = barWidth(1000);
    return (w: number) => {
      width.mockReturnValue({ width: w } as DOMRect);
      act(() => observers.forEach((fire) => fire()));
    };
  };

  it('keeps a refused Project draft when the row unfolds', async () => {
    const resize = stubResize();
    renderBar();
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project' }));
    const input = (await screen.findByTestId('fields-projection')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '{a: }' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('fields-projection')).toBeNull());

    resize(1500);
    const pill = await screen.findByTestId('option-pill-project');
    expect(pill.getAttribute('data-status')).toBe('invalid');
    fireEvent.click(pill);
    expect(((await screen.findByTestId('fields-projection')) as HTMLInputElement).value).toBe('{a: }');
    vi.unstubAllGlobals();
  });

  it('commits a Project draft whose editor a resize across the fold closed', async () => {
    const resize = stubResize();
    const { actions } = renderBar();
    fireEvent.click(screen.getByTestId('query-bar-options-folded'));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Project' }));
    fireEvent.change(await screen.findByTestId('fields-projection'), { target: { value: 'name' } });

    resize(1500);
    await waitFor(() => expect(screen.queryByTestId('fields-projection')).toBeNull());
    await waitFor(() => expect(actions.patchWith).toHaveBeenCalled());
    const fn = vi.mocked(actions.patchWith).mock.calls[0][0];
    expect(fn(makeState()).builder?.projection).toEqual(['name']);
    vi.unstubAllGlobals();
  });

  it('has nothing to fold while options are kept expanded', () => {
    barWidth(1000);
    renderBar({ ...makeState(), optionsExpanded: true });
    expect(screen.queryByTestId('query-bar-options-folded')).toBeNull();
    expect(screen.getByTestId('option-pill-project')).toBeTruthy();
  });
});

describe('Filter Bar row — the collapse steps follow the width', () => {
  it('labels Save and Queries at full width', () => {
    renderBar();
    expect(screen.getByRole('button', { name: 'Save' }).textContent).toBe('Save');
    expect(queriesButton().textContent).toBe('Queries');
  });

  it('draws the dividers until the run form drops them', () => {
    const { unmount } = renderBar();
    expect(screen.getAllByTestId('filter-bar-divider')).toHaveLength(2);
    unmount();
    barWidth(940);
    renderBar();
    expect(screen.queryAllByTestId('filter-bar-divider')).toHaveLength(0);
  });

  it('drops the ⌘↵ hint from Run in the run form, and wraps the controls below it', () => {
    barWidth(940);
    const { unmount } = renderBar();
    expect(screen.getByTestId('query-run-btn').textContent).toBe('Run');
    expect(screen.getByTestId('filter-bar-row').style.flexWrap).toBe('nowrap');
    unmount();
    barWidth(700);
    renderBar();
    expect(screen.getByTestId('filter-bar-row').style.flexWrap).toBe('wrap');
  });

  it('shows Run with its hint at full width', () => {
    renderBar();
    expect(screen.getByTestId('query-run-btn').textContent).toMatch(/^Run.+/);
  });
});

describe('Filter Bar row — Queries', () => {
  it('keeps Save as its own button, with the save hint anchor', () => {
    const { actions } = renderBar();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('data-hint-anchor')).toBe('saved.create');
    fireEvent.click(save);
    expect(actions.openSave).toHaveBeenCalledTimes(1);
  });

  it('names the icon form of Queries and keeps its test id', () => {
    barWidth(1100);
    renderBar();
    expect(screen.getByRole('button', { name: 'Saved queries and history' })).toBe(queriesButton());
  });

  it('opens one popover with a Saved and a History tab, on Saved the first time', async () => {
    renderBar(makeState(), 'first-time');
    openQueries();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Saved', 'History']);
    expect(selectedTab()).toEqual(['Saved']);
    expect(await within(dialog).findByRole('textbox', { name: 'Search saved queries' })).toBeTruthy();
  });

  it('shows the History list on its tab', async () => {
    renderBar(makeState(), 'history-tab');
    openQueries();
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByRole('textbox', { name: 'Search recent queries' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Search saved queries' })).toBeNull();
  });

  it('reopens on the list last used in that workspace tab, and not in another', async () => {
    const first = renderBar(makeState(), 'tab-a');
    openQueries();
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
    fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Search recent queries' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    openQueries();
    await screen.findByRole('dialog');
    expect(selectedTab()).toEqual(['History']);
    first.unmount();

    renderBar(makeState(), 'tab-b');
    openQueries();
    await screen.findByRole('dialog');
    expect(selectedTab()).toEqual(['Saved']);
  });

  it('opens on Saved for the palette\'s rename request, over the list last used', async () => {
    renderBar(makeState(), 'tab-rename');
    openQueries();
    fireEvent.click(await screen.findByRole('tab', { name: 'History' }));
    await screen.findByRole('textbox', { name: 'Search recent queries' });

    act(() => requestSavedRename('tab-rename', 'q1'));
    await waitFor(() => expect(selectedTab()).toEqual(['Saved']));
    expect(await screen.findByRole('textbox', { name: 'Search saved queries' })).toBeTruthy();
  });

  it('does not stay open over another workspace tab after a tab switch', async () => {
    const actions = emptyWorkspaceActions();
    const { rerender } = render(<Bar actions={actions} tabId="tab-left" initial={makeState()} />);
    openQueries();
    await screen.findByRole('dialog');

    rerender(<Bar actions={actions} tabId="tab-right" initial={makeState()} />);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(queriesButton().getAttribute('aria-expanded')).not.toBe('true');
  });

  it('closes on Escape', async () => {
    renderBar(makeState(), 'tab-escape');
    openQueries();
    fireEvent.keyDown(await screen.findByRole('textbox', { name: 'Search saved queries' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
