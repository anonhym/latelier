import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceMeta } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';
import { resultQueryKey } from '../../src/pages/Workspace/builder';
import {
  CANCELLED_NOTICE_MS,
  _resetRunClocksForTests,
  cancelRunClock,
  startRunClock,
} from '../../src/pages/Workspace/runClock';

let originalClipboard: Clipboard | undefined;
let writeText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});
afterEach(() => {
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

const DOCS = [
  { _id: { $oid: '507f1f77bcf86cd799439011' }, name: 'alpha' },
  { _id: { $oid: '507f1f77bcf86cd799439012' }, name: 'beta' },
];

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'JSON',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: DOCS,
      durationMs: 5,
      ranAt: new Date().toISOString(),
    },
    ...overrides,
  };
}

const makeMeta = emptyWorkspaceMeta;

function renderBar(
  onDeleteSelected: (docs: unknown[]) => void,
  metaOverrides: Partial<CollectionWorkspaceMeta> = {},
) {
  return render(
    <CollectionWorkspaceProvider
      state={makeState()}
      actions={emptyWorkspaceActions()}
      meta={makeMeta(metaOverrides)}
    >
      <ResultViewer>
        <ResultViewer.SelectionBar onDeleteSelected={onDeleteSelected} />
        <ResultViewer.Json />
      </ResultViewer>
    </CollectionWorkspaceProvider>,
  );
}

function selectFirstCard() {
  // A plain click on the card no longer selects it — the visible checkbox
  // (or ⌘/Ctrl+click) is the way in now.
  fireEvent.click(screen.getByRole('button', { name: 'Select document …99439011' }));
}

describe('SelectionActionBar', () => {
  it('AC1 — renders nothing when no rows are selected', () => {
    const { container } = renderBar(vi.fn());
    expect(container.textContent).not.toContain('selected');
  });

  // #106 — jsdom has no layout, so this can't measure the rendered height;
  // it guards that the strip stays mounted at the same fixed inline height in
  // both states, and that a selection never lands in it. The e2e measures the
  // real grid position.
  it('#106 — the strip stays mounted at the same fixed height, and a selection floats outside it', () => {
    const { container } = renderBar(vi.fn());
    const strip = () => container.querySelector<HTMLElement>('[data-testid="selection-bar"]')!;
    expect(strip()).not.toBeNull();
    expect(strip().style.height).toBe('31px');
    expect(strip().style.boxSizing).toBe('border-box');
    selectFirstCard();
    expect(strip().style.height).toBe('31px');
    expect(strip().contains(screen.getByTestId('selection-bar-count'))).toBe(false);
  });

  it('draws no hint row with nothing selected (W06 §8.1)', () => {
    const { container } = renderBar(vi.fn());
    expect(container.querySelector('[data-testid="band-hint"]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-testid="selection-bar"]')!.textContent).toBe('');
    expect(container.textContent).not.toMatch(/Select rows with the checkbox/);
  });

  it('a selection is a floating pill at the bottom centre: count · Copy ▾ · Delete · ✕', () => {
    renderBar(vi.fn());
    expect(screen.queryByRole('group', { name: 'Selection' })).toBeNull();
    selectFirstCard();
    const pill = screen.getByRole('group', { name: 'Selection' });
    expect(pill.style.position).toBe('absolute');
    expect(pill.style.left).toBe('50%');
    expect(pill.style.bottom).toBe('16px');
    expect([...pill.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Copy',
      'Copy as…',
      'Delete',
      'Clear selection',
    ]);
  });

  it('checkboxes carry the hook that hides them off hover, and the canvas flags a selection so every row shows its own', () => {
    const { container } = render(
      <CollectionWorkspaceProvider state={makeState()} actions={emptyWorkspaceActions()} meta={makeMeta()}>
        <ResultViewer>
          <ResultViewer.Body onClearFilter={() => {}} onColumnResize={() => {}} onRowExpand={() => {}} />
        </ResultViewer>
      </CollectionWorkspaceProvider>,
    );
    const toggles = container.querySelectorAll('[data-select-toggle]');
    expect(toggles).toHaveLength(DOCS.length);
    expect(container.querySelector('[data-has-selection]')).toBeNull();
    selectFirstCard();
    expect(container.querySelector('[data-has-selection]')).not.toBeNull();
  });

  it('a re-run over rows marks them as the previous results, in the same band height', () => {
    const { container } = renderBar(vi.fn(), { isLoading: true });
    expect(screen.getByRole('status').textContent).toBe('Previous results');
    expect(container.querySelector<HTMLElement>('[data-testid="selection-bar"]')!.style.height).toBe('31px');
  });

  it('on a view the pill has no Delete', () => {
    renderBar(vi.fn(), { isView: true });
    selectFirstCard();
    expect(screen.getByRole('group', { name: 'Selection' })).toBeTruthy();
    expect(screen.queryByTestId('selection-bar-delete')).toBeNull();
  });

  it('#106 — read-only still renders nothing at all, strip included', () => {
    const { container } = renderBar(vi.fn(), { isReadOnly: true });
    expect(container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });

  // Mounted before the first selection: a live region that appears with its
  // text is not announced, so the count would go unheard.
  it('announces the count through a polite live region that is there before anything is selected', () => {
    renderBar(vi.fn());
    const live = screen.getByTestId('selection-live');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('');
    selectFirstCard();
    expect(live.textContent).toBe('1 selected');
  });

  it('AC2 — shows the selection count once a row is selected', () => {
    const { container } = renderBar(vi.fn());
    selectFirstCard();
    expect(container.textContent).toContain('1 selected');
  });

  it('AC3 — Copy writes the selected doc to the clipboard as canonical EJSON', async () => {
    const { container } = renderBar(vi.fn());
    selectFirstCard();
    fireEvent.click(container.querySelector('[data-testid="selection-bar-copy"]')!);
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    const written = writeText.mock.calls[0]![0] as string;
    expect(JSON.parse(written)).toEqual(DOCS[0]);
  });

  it('AC4 — Delete calls onDeleteSelected with the selected docs', () => {
    const onDeleteSelected = vi.fn();
    const { container } = renderBar(onDeleteSelected);
    selectFirstCard();
    fireEvent.click(container.querySelector('[data-testid="selection-bar-delete"]')!);
    expect(onDeleteSelected).toHaveBeenCalledTimes(1);
    expect(onDeleteSelected).toHaveBeenCalledWith([DOCS[0]]);
  });

  it('AC7 — never renders for a read-only (isReadOnly) consumer, even with a selection', () => {
    const { container } = renderBar(vi.fn(), { isReadOnly: true });
    selectFirstCard();
    expect(container.textContent).not.toContain('selected');
  });

  it('disables Delete when no selected doc has an _id (would otherwise risk a full-collection delete)', () => {
    const onDeleteSelected = vi.fn();
    const state = makeState({
      lastRun: {
        documents: [{ name: 'no-id-doc' }],
        durationMs: 1,
        ranAt: new Date().toISOString(),
      },
    });
    const { container } = render(
      <CollectionWorkspaceProvider state={state} actions={emptyWorkspaceActions()} meta={makeMeta()}>
        <ResultViewer>
          <ResultViewer.SelectionBar onDeleteSelected={onDeleteSelected} />
          <ResultViewer.Json />
        </ResultViewer>
      </CollectionWorkspaceProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select document (no _id)' }));
    const deleteButton = container.querySelector(
      '[data-testid="selection-bar-delete"]',
    ) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });
});

// W06 §8.2 — rows that answer another query than the one in the bar say so,
// in the band above them, without being dimmed.
describe('SelectionActionBar — results that are not current', () => {
  const ranOn = makeState({ queryRaw: '{"a":1}' });
  const ran = { ...ranOn, lastRunQueryKey: resultQueryKey(ranOn) ?? undefined };

  function renderBand(state: CollectionTabState, metaOverrides: Partial<CollectionWorkspaceMeta> = {}) {
    const actions = emptyWorkspaceActions();
    const utils = render(
      <CollectionWorkspaceProvider state={state} actions={actions} meta={makeMeta(metaOverrides)}>
        <ResultViewer>
          <ResultViewer.SelectionBar onDeleteSelected={vi.fn()} />
          <ResultViewer.Json />
        </ResultViewer>
      </CollectionWorkspaceProvider>,
    );
    return { ...utils, actions, band: screen.getByTestId('selection-bar') };
  }

  it('says nothing while the rows answer the query in the bar', () => {
    renderBand(ran);
    expect(screen.queryByTestId('band-stale')).toBeNull();
  });

  it('says the rows are from the previous filter once it is edited, and runs from there', () => {
    const { actions, band } = renderBand({ ...ran, queryRaw: '{"a":2}' });
    expect(screen.getByTestId('band-stale').textContent).toBe('These results are from the previous filter.');
    expect(band.style.height).toBe('31px');

    fireEvent.click(screen.getByTestId('band-run'));
    expect(actions.run).toHaveBeenCalledTimes(1);
  });

  it('offers no Run while the query in the bar cannot run', () => {
    renderBand({ ...ran, queryRaw: '{"a":' });
    expect(screen.getByTestId('band-stale')).toBeTruthy();
    expect(screen.queryByTestId('band-run')).toBeNull();
  });

  it('gives the band to a run in flight, then back', () => {
    renderBand({ ...ran, queryRaw: '{"a":2}' }, { isLoading: true });
    expect(screen.queryByTestId('band-stale')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Previous results');
  });

  it('keeps the stale line in the band while rows are selected', () => {
    renderBand({ ...ran, queryRaw: '{"a":2}' });
    selectFirstCard();
    // The pill still floats over the rows; the band keeps the stale line.
    expect(screen.getByTestId('band-stale')).toBeTruthy();
    expect(screen.getByTestId('selection-bar-count').textContent).toContain('1');
  });
});

// W05 §9.5 — a cancelled run says how long it ran, for a few seconds.
describe('SelectionActionBar — after a cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetRunClocksForTests();
    vi.useRealTimers();
  });

  function cancelAfter(ms: number) {
    act(() => {
      startRunClock('t1');
      vi.advanceTimersByTime(ms);
      cancelRunClock('t1');
    });
  }

  it('says how long the cancelled run ran, and that the rows are the previous ones', () => {
    renderBar(vi.fn());
    cancelAfter(3500);
    expect(screen.getByTestId('band-cancelled').textContent).toBe('Cancelled after 3.5 s — showing previous results');

    act(() => {
      vi.advanceTimersByTime(CANCELLED_NOTICE_MS);
    });
    expect(screen.queryByTestId('band-cancelled')).toBeNull();
  });

  it('claims no previous results when there are no rows', () => {
    render(
      <CollectionWorkspaceProvider
        state={makeState({ lastRun: { documents: [], durationMs: 1, ranAt: new Date().toISOString() } })}
        actions={emptyWorkspaceActions()}
        meta={makeMeta()}
      >
        <ResultViewer>
          <ResultViewer.SelectionBar onDeleteSelected={vi.fn()} />
        </ResultViewer>
      </CollectionWorkspaceProvider>,
    );
    cancelAfter(1200);
    expect(screen.getByTestId('band-cancelled').textContent).toBe('Cancelled after 1.2 s');
  });

  it('is another tab\'s notice only on that tab', () => {
    renderBar(vi.fn(), { tabId: 'other' });
    cancelAfter(1000);
    expect(screen.queryByTestId('band-cancelled')).toBeNull();
  });
});
