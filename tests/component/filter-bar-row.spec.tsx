import React from 'react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  act,
  render,
  fireEvent,
  screen,
  within,
  emptyWorkspaceActions,
  emptyWorkspaceMeta,
} from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import {
  CANCELLED_NOTICE_MS,
  _resetRunClocksForTests,
  cancelRunClock,
  settleRunClock,
  startRunClock,
} from '../../src/pages/Workspace/runClock';
import type { CollectionWorkspaceActions, CollectionWorkspaceMeta } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

/**
 * W05 §9 — what the Filter Bar row says about the query as it is typed, at a
 * commit point, and while it runs. The option pills have their own spec.
 */

function makeState(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    ...over,
  };
}

/** Holds the tab state as the Workspace does: a patch comes back as props. */
function Bar({
  initial,
  actions,
  meta,
  bar,
}: {
  initial: CollectionTabState;
  actions: CollectionWorkspaceActions;
  meta?: Partial<CollectionWorkspaceMeta>;
  bar?: Partial<React.ComponentProps<typeof QueryBar>>;
}) {
  const [state, setState] = React.useState(initial);
  const live = React.useMemo<CollectionWorkspaceActions>(
    () => ({
      ...actions,
      patch: (patch) => {
        actions.patch(patch);
        setState((prev) => ({ ...prev, ...patch }));
      },
    }),
    [actions],
  );
  return (
    <CollectionWorkspaceProvider state={state} actions={live} meta={emptyWorkspaceMeta({ tabId: 't1', ...meta })}>
      <QueryBar suggestionContext={null} {...bar} />
    </CollectionWorkspaceProvider>
  );
}

function renderBar(
  state: CollectionTabState = makeState(),
  opts: { meta?: Partial<CollectionWorkspaceMeta>; bar?: Partial<React.ComponentProps<typeof QueryBar>> } = {},
) {
  const actions = emptyWorkspaceActions();
  const utils = render(<Bar initial={state} actions={actions} meta={opts.meta} bar={opts.bar} />);
  return { ...utils, actions };
}

const filter = () => screen.getByTestId('query-bar-input') as HTMLTextAreaElement;
const runButton = () => screen.getByTestId('query-run-btn') as HTMLButtonElement;
const strip = () => screen.queryByTestId('query-bar-strip');
const note = () => screen.queryByTestId('query-bar-syntax-note');
const type = (value: string) => fireEvent.change(filter(), { target: { value } });

beforeEach(() => installAtelierMock());
afterEach(() => {
  _resetRunClocksForTests();
  vi.useRealTimers();
  uninstallAtelierMock();
});

// X14 §11 — a filter the blur would repair is a filter that runs: nothing may
// call it invalid while it is being typed.
describe('Filter Bar row — Shell Syntax as it is typed', () => {
  it('keeps Run open, says what will happen, and raises no alert', () => {
    renderBar();
    type('{ age: { $gt: 30 } }');

    expect(runButton().disabled).toBe(false);
    expect(runButton().textContent).toContain('Run');
    expect(note()!.textContent).toBe('mongosh syntax — rewritten as EJSON when you run');
    expect(note()!.getAttribute('role')).toBeNull();
    expect(strip()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Not rewritten under the cursor.
    expect(filter().value).toBe('{ age: { $gt: 30 } }');
  });

  it('says nothing about a filter that is already EJSON', () => {
    renderBar();
    type('{"age":{"$gt":30}}');
    expect(note()).toBeNull();
    expect(strip()).toBeNull();
  });

  it('rewrites it on blur, and the note goes with the mongosh text', () => {
    renderBar();
    type('{ age: { $gt: 30 } }');
    fireEvent.blur(filter());

    expect(JSON.parse(filter().value)).toEqual({ age: { $gt: 30 } });
    expect(note()).toBeNull();
    expect(strip()).toBeNull();
  });

  it('runs what the blur would have written', () => {
    const { actions } = renderBar();
    type('{ age: { $gt: 30 } }');
    fireEvent.click(runButton());

    expect(actions.run).toHaveBeenCalledTimes(1);
    const override = vi.mocked(actions.run).mock.calls[0]![0] as Partial<CollectionTabState>;
    expect(JSON.parse(override.queryRaw!)).toEqual({ age: { $gt: 30 } });
  });
});

// W05 §9.3 — the reason a query cannot run is one sentence under the row,
// raised at a commit point and never per keystroke.
describe('Filter Bar row — a filter that cannot run', () => {
  it('closes Run as it is typed, without an alert', () => {
    renderBar();
    type('{ age: ');

    expect(runButton().disabled).toBe(true);
    expect(runButton().textContent).toBe('Fix filter to run');
    expect(strip()).toBeNull();
    expect(note()).toBeNull();
  });

  it('says why on blur, whole and wrapped, as the one alert', () => {
    renderBar();
    type('{ age: ');
    fireEvent.blur(filter());

    const alert = screen.getByRole('alert');
    expect(alert).toBe(strip());
    expect(alert.textContent!.startsWith('⚠ ')).toBe(true);
    expect(alert.textContent!.length).toBeGreaterThan(4);
    expect(alert.style.overflowWrap).toBe('anywhere');
    expect(alert.style.whiteSpace).not.toBe('nowrap');
    // The filter is described by it, so a screen reader reads the reason there.
    expect(filter().getAttribute('aria-describedby')).toBe(alert.id);
    expect(filter().value).toBe('{ age: ');
  });

  it('retires the sentence at the next edit, and opens Run once the filter parses', () => {
    renderBar();
    type('{ age: ');
    fireEvent.blur(filter());
    expect(strip()).not.toBeNull();

    type('{ age: 1');
    expect(strip()).toBeNull();
    expect(runButton().disabled).toBe(true);

    type('{ age: 1 }');
    expect(strip()).toBeNull();
    expect(runButton().disabled).toBe(false);
  });

  it('says why at once for a tab restored with a filter that cannot run', () => {
    renderBar(makeState({ queryRaw: '{ age: ' }));
    expect(strip()).not.toBeNull();
    expect(runButton().disabled).toBe(true);
  });
});

describe('Filter Bar row — the Builder button', () => {
  it('is absent where nothing can toggle the builder', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Builder' })).toBeNull();
  });

  it.each([
    [false, 'false'],
    [true, 'true'],
  ])('says whether the builder is open (%s) and toggles it', (builderOpen, pressed) => {
    const onToggleBuilder = vi.fn();
    renderBar(makeState(), { bar: { builderOpen, onToggleBuilder } });

    const button = within(screen.getByTestId('filter-bar-row')).getByRole('button', { name: 'Builder' });
    expect(button.getAttribute('aria-pressed')).toBe(pressed);
    fireEvent.click(button);
    expect(onToggleBuilder).toHaveBeenCalledTimes(1);
  });
});

// W05 §9.5 — a find in flight shows in the row itself, not only on the button.
describe('Filter Bar row — while a find runs', () => {
  it('draws the running bar and swaps Run for Cancel', () => {
    const { actions } = renderBar(makeState(), { meta: { isLoading: true } });

    expect(screen.getByRole('progressbar', { name: 'Query running' })).toBe(screen.getByTestId('query-running-bar'));
    expect(screen.queryByTestId('query-run-btn')).toBeNull();
    fireEvent.click(screen.getByTestId('query-cancel-btn'));
    expect(actions.cancel).toHaveBeenCalledTimes(1);
  });

  it('draws neither at rest', () => {
    renderBar();
    expect(screen.queryByTestId('query-running-bar')).toBeNull();
    expect(screen.queryByTestId('query-cancel-btn')).toBeNull();
  });
});

// W05 §9.5, W01 §14.6 — the status bar counts the run, and says how long a
// cancelled one ran.
describe('Status bar — a find in flight', () => {
  const RUN = { documents: new Array(3).fill({}), durationMs: 2, ranAt: '2026-01-01T00:00:00.000Z' };

  function status(isLoading: boolean, state = makeState({ lastRun: RUN, totalCount: 3 })) {
    return (
      <CollectionWorkspaceProvider
        state={state}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta({ tabId: 't1', isLoading })}
      >
        <StatusBar connection={null} />
        <ResultBar />
      </CollectionWorkspaceProvider>
    );
  }
  const slot = () => screen.getByTestId('result-count-slot');

  beforeEach(() => vi.useFakeTimers());

  it('counts the seconds in place of the count, as a status', () => {
    act(() => startRunClock('t1'));
    render(status(true));

    const running = screen.getByTestId('result-running');
    expect(running.getAttribute('role')).toBe('status');
    expect(running.textContent).toBe('Running · 0 s');
    expect(slot().textContent).not.toContain('results');

    act(() => { vi.advanceTimersByTime(3000); });
    expect(running.textContent).toBe('Running · 3 s');

    act(() => { vi.advanceTimersByTime(60_000); });
    expect(running.textContent).toBe('Running · 1 min 3 s');
  });

  it('goes back to the count and the duration once the find answers', () => {
    act(() => startRunClock('t1'));
    const { rerender } = render(status(true));
    act(() => settleRunClock('t1'));
    rerender(status(false));

    expect(screen.queryByTestId('result-running')).toBeNull();
    expect(slot().textContent).toContain('3 documents');
    expect(slot().textContent).toContain('2 ms');
  });

  it('says how long a cancelled find ran, to the tenth, then goes back to the count', () => {
    act(() => startRunClock('t1'));
    const { rerender } = render(status(true));
    act(() => { vi.advanceTimersByTime(2300); });
    act(() => cancelRunClock('t1'));
    rerender(status(false));

    const cancelled = screen.getByTestId('result-cancelled');
    expect(cancelled.getAttribute('role')).toBe('status');
    expect(cancelled.textContent).toBe('Cancelled after 2.3 s');

    act(() => { vi.advanceTimersByTime(CANCELLED_NOTICE_MS); });
    expect(screen.queryByTestId('result-cancelled')).toBeNull();
    expect(slot().textContent).toContain('3 documents');
  });

  it('reads another tab\'s clock as none of its own', () => {
    act(() => startRunClock('t2'));
    render(status(false));
    expect(screen.queryByTestId('result-running')).toBeNull();
    expect(slot().textContent).toContain('3 documents');
  });
});
