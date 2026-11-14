import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  fireEvent,
  screen,
  expectSeparatorClampedAtBounds,
  expectSeparatorResizesPanel,
} from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { OutputPanel, type PreviewStage } from '../../src/pages/Workspace/Aggregation/OutputPanel';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { notifications } from '@mantine/notifications';
import type { AggregationLastRun } from '@shared/types';

let originalClipboard: Clipboard | undefined;
beforeEach(() => {
  installAtelierMock();
  originalClipboard = navigator.clipboard;
});
afterEach(() => {
  // Mantine's notification store is module-global and outlives RTL's
  // unmount, so a toast raised by one test would still be on screen for the
  // next one's "did it *not* claim success?" assertion.
  notifications.clean();
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

type PanelProps = React.ComponentProps<typeof OutputPanel>;

function panelProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    stacked: false,
    onToggleStacked: vi.fn(),
    height: 260,
    view: 'Tree',
    lastRun: undefined,
    outputStale: false,
    running: false,
    pipelineName: null,
    stage: null,
    onRunToStage: vi.fn(),
    onHeightChange: vi.fn(),
    onHeightCommit: vi.fn(),
    onViewChange: vi.fn(),
    onSaveAsCollection: vi.fn(),
    onSaveAsView: vi.fn(),
    onRun: vi.fn(),
    runBlockedReason: null,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<PanelProps> = {}) {
  return render(<OutputPanel {...panelProps(overrides)} />);
}

/** Opens `Export results ▾` and returns the item named `name`. */
async function exportItem(name: string): Promise<HTMLButtonElement> {
  await userEvent.click(screen.getByRole('button', { name: 'Export results' }));
  return (await screen.findByRole('menuitem', { name })) as HTMLButtonElement;
}

/**
 * P1-12 coverage for OutputPanel.
 */
// Required by `AggregationLastRun`; these specs assert on rows/duration/error only.
const runMeta = { ranAt: '2026-04-21T12:00:00.000Z', stageCounts: {}, stageSamples: {} };

describe('OutputPanel — rendering and view switching', () => {
  it('shows row count and durationMs from lastRun', () => {
    const lastRun: AggregationLastRun = {
      ...runMeta,
      rows: [{ _id: 1 }, { _id: 2 }, { _id: 3 }],
      durationMs: 42,
    };
    const { container } = renderPanel({ lastRun });
    expect(container.textContent).toContain('3 docs');
    expect(container.textContent).toContain('42 ms');
  });

  it('renders an error banner from lastRun.error with role="alert"', () => {
    const lastRun: AggregationLastRun = {
      ...runMeta,
      rows: [],
      durationMs: 0,
      error: { code: 'MONGO_ERROR', message: 'pipeline blew up' },
    };
    renderPanel({ lastRun });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('MONGO_ERROR: pipeline blew up');
  });

  it('offers the next run from each state, and only when the toolbar could run', () => {
    const onRun = vi.fn();
    const failed = { ...runMeta, rows: [], durationMs: 0, error: { code: 'X', message: 'boom' } };
    const empty = { ...runMeta, rows: [], durationMs: 3 };
    const cases: Array<[AggregationLastRun | undefined, string, string]> = [
      [undefined, 'Run the pipeline to see output', 'Run pipeline'],
      [failed, 'The pipeline failed', 'Run again'],
      [empty, 'The pipeline returned no documents', 'Run again'],
    ];
    for (const [lastRun, title, button] of cases) {
      const { unmount } = renderPanel({ lastRun, onRun });
      expect(screen.getByText(title)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: button }));
      unmount();
    }
    expect(onRun).toHaveBeenCalledTimes(3);

    renderPanel({ lastRun: empty, runBlockedReason: 'Fix stage 1 to run: body is empty' });
    expect((screen.getByRole('button', { name: 'Run again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables the next run while a run is in flight', () => {
    renderPanel({ lastRun: { ...runMeta, rows: [], durationMs: 3 }, running: true });
    expect((screen.getByRole('button', { name: 'Run again' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('orders the view switch as the Documents canvas does: Table, Tree, JSON', () => {
    renderPanel();
    const labels = [...screen.getByTestId('output-bar').querySelectorAll('label')].map((l) => l.textContent);
    expect(labels).toEqual(['Table', 'Tree', 'JSON']);
  });

  it('invokes onViewChange when the user clicks a view button', () => {
    const onViewChange = vi.fn();
    renderPanel({ view: 'Tree', onViewChange });
    fireEvent.click(screen.getByText('JSON'));
    expect(onViewChange).toHaveBeenCalledWith('JSON');
    fireEvent.click(screen.getByText('Table'));
    expect(onViewChange).toHaveBeenLastCalledWith('Table');
  });


  // Copy used to `.catch(() => {})`, so a denied clipboard was
  // indistinguishable from a successful copy.
  it('reports a copied output', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(await exportItem('Copy'));

    expect(await screen.findByText(/Output copied to the clipboard/)).toBeTruthy();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Could not copy to the clipboard/)).toBeNull();
  });

  it('reports a rejected copy rather than claiming success', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(await exportItem('Copy'));

    await screen.findByText(/Could not copy to the clipboard/);
    expect(screen.queryByText(/Output copied to the clipboard/)).toBeNull();
  });

  it('reports a failed save instead of swallowing it', async () => {
    const saveFile = vi.fn(async () => {
      throw new Error('EACCES: permission denied');
    });
    installAtelierMock({ app: { saveFile } as never });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(await exportItem('Download…'));

    expect(await screen.findByText(/Could not save the output: .*permission denied/)).toBeTruthy();
  });

  it('says nothing when the save panel is cancelled', async () => {
    const saveFile = vi.fn(async () => ({ path: null }));
    installAtelierMock({ app: { saveFile } as never });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(await exportItem('Download…'));

    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Could not save the output/)).toBeNull();
  });

  it('shows the Running… overlay when running is true', () => {
    const { container } = renderPanel({ running: true, lastRun: { ...runMeta, rows: [], durationMs: 0 } });
    expect(container.textContent).toContain('Running');
  });

  it('keeps one polite status region mounted and announces both start and finish of a run', () => {
    const finished: AggregationLastRun = { ...runMeta, rows: [{ _id: 1 }, { _id: 2 }], durationMs: 5 };
    const panel = (running: boolean, lastRun?: AggregationLastRun) => (
      <OutputPanel {...panelProps({ running, lastRun })} />
    );
    const { rerender } = render(panel(false));
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');

    rerender(panel(true));
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Running…');

    rerender(panel(false, finished));
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('Finished: 2 documents');

    rerender(
      panel(false, { ...runMeta, rows: [], durationMs: 1, error: { code: 'X', message: 'boom' } }),
    );
    expect(region.textContent).toBe('Run failed');
  });

  it('renders the document count with tabular numerals', () => {
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 1 } });
    const heading = screen.getByTestId('preview-heading');
    expect(heading.textContent).toBe('Output · 1 docs · 1 ms');
    expect(heading.style.fontVariantNumeric).toBe('tabular-nums');
  });
});

/**
 * `height` is controlled by the caller (AggregationTab, in the real app).
 * A `vi.fn()` spy on `onHeightChange` can't prove `aria-valuenow` tracks a
 * keyboard resize, so this wrapper feeds it back into real state.
 */
function ControlledOutputPanel() {
  const [height, setHeight] = useState(260);
  return <OutputPanel {...panelProps({ stacked: true, height, onHeightChange: setHeight })} />;
}

describe('OutputPanel resize keyboard support (#56)', () => {
  it('has no height handle beside the stages, where the column divider resizes instead', () => {
    renderPanel({ stacked: false });
    expect(screen.queryByRole('separator', { name: 'Resize output panel' })).toBeNull();
  });

  it('opts in to the shared keyboard-focus highlight', () => {
    render(<ControlledOutputPanel />);
    expect(screen.getByRole('separator', { name: 'Resize output panel' }).classList.contains('resize-separator')).toBe(true);
  });

  it('is reachable by Tab alone', async () => {
    const user = userEvent.setup();
    render(<ControlledOutputPanel />);
    const handle = screen.getByRole('separator', { name: 'Resize output panel' });

    await user.tab();

    expect(document.activeElement).toBe(handle);
  });

  it('ArrowUp/ArrowDown resize the panel and keep aria-valuenow and the real height in sync', async () => {
    const user = userEvent.setup();
    render(<ControlledOutputPanel />);
    const handle = screen.getByRole('separator', { name: 'Resize output panel' });
    const panel = handle.parentElement as HTMLElement;
    await user.tab();

    await expectSeparatorResizesPanel(handle, panel, {
      growKey: '{ArrowUp}',
      shrinkKey: '{ArrowDown}',
      afterGrow: '270',
      afterShrink: '250',
    });
  });

  it('Home and End reach the real bounds and stay clamped and focused past them', async () => {
    const user = userEvent.setup();
    render(<ControlledOutputPanel />);
    const handle = screen.getByRole('separator', { name: 'Resize output panel' });
    // Same 0.7-of-viewport ceiling `clampHeight` uses — not hardcoded here,
    // so this doesn't drift if jsdom's default viewport size ever changes.
    const maxHeight = Math.floor(window.innerHeight * 0.7);
    await user.tab();

    await expectSeparatorClampedAtBounds(handle, {
      min: '120',
      max: String(maxHeight),
      shrinkKey: '{ArrowDown}',
      growKey: '{ArrowUp}',
    });
  });

  it('Enter resets to the default height, the keyboard equivalent of the double-click reset', async () => {
    const user = userEvent.setup();
    render(<ControlledOutputPanel />);
    const handle = screen.getByRole('separator', { name: 'Resize output panel' });
    await user.tab();

    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(handle.getAttribute('aria-valuenow')).toBe('280');

    await user.keyboard('{Enter}');
    expect(handle.getAttribute('aria-valuenow')).toBe('260');
    expect(document.activeElement).toBe(handle);
  });

  // `aria-valuemax` is metadata, not the clamp itself — `clampHeight` reads
  // `window.innerHeight` fresh on every drag/keypress regardless, so a resize
  // mid-interaction always clamps correctly either way. This only pins that
  // the *displayed* bound doesn't go stale when nothing else re-renders.
  it('updates aria-valuemax when the window resizes while nothing else changes', () => {
    const originalInnerHeight = window.innerHeight;
    try {
      render(<ControlledOutputPanel />);
      const handle = screen.getByRole('separator', { name: 'Resize output panel' });
      const before = handle.getAttribute('aria-valuemax');

      Object.defineProperty(window, 'innerHeight', { value: 2000, configurable: true });
      fireEvent(window, new Event('resize'));

      expect(handle.getAttribute('aria-valuemax')).toBe(String(Math.floor(2000 * 0.7)));
      expect(handle.getAttribute('aria-valuemax')).not.toBe(before);
    } finally {
      Object.defineProperty(window, 'innerHeight', { value: originalInnerHeight, configurable: true });
    }
  });
});

describe('OutputPanel — Export results', () => {
  const withRows: AggregationLastRun = { ...runMeta, rows: [{ _id: 1 }], durationMs: 3 };

  it('is one menu of four items, and nothing in the header is named "Save as"', async () => {
    renderPanel({ lastRun: withRows });
    const bar = screen.getByTestId('output-bar');
    expect(bar.textContent).not.toMatch(/Save as/);
    await userEvent.click(screen.getByRole('button', { name: 'Export results' }));
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual(['Copy', 'Download…', 'Save to collection…', 'Create view…']);
  });

  it('copies the same readable EJSON array as before', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1, n: 2 }, { _id: 2 }], durationMs: 3 } });

    fireEvent.click(await exportItem('Copy'));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith('[\n  {\n    "_id": 1,\n    "n": 2\n  },\n  {\n    "_id": 2\n  }\n]');
  });

  it('downloads the full output under the pipeline name', async () => {
    const saveFile = vi.fn(async () => ({ path: '/tmp/x.json' }));
    installAtelierMock({ app: { saveFile } as never });
    renderPanel({ lastRun: withRows, pipelineName: 'byMonth' });

    fireEvent.click(await exportItem('Download…'));

    await vi.waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(saveFile).toHaveBeenCalledWith({ defaultName: 'byMonth-output.json', content: '[\n  {\n    "_id": 1\n  }\n]' });
  });

  it('Save to collection… and Create view… call what Save as… and Save as view… called', async () => {
    const onSaveAsCollection = vi.fn();
    const onSaveAsView = vi.fn();
    renderPanel({ lastRun: withRows, onSaveAsCollection, onSaveAsView });

    fireEvent.click(await exportItem('Save to collection…'));
    fireEvent.click(await exportItem('Create view…'));

    expect(onSaveAsCollection).toHaveBeenCalledOnce();
    expect(onSaveAsView).toHaveBeenCalledOnce();
  });

  it('with no rows, only Create view… is available: it saves the pipeline, not rows', async () => {
    renderPanel({ lastRun: { ...runMeta, rows: [], durationMs: 5 } });
    await userEvent.click(screen.getByRole('button', { name: 'Export results' }));
    const disabled = (await screen.findAllByRole('menuitem')).map((i) => i.hasAttribute('disabled'));
    expect(disabled).toEqual([true, true, true, false]);
  });

  it('while running, Save to collection… and Create view… are unavailable', async () => {
    renderPanel({ lastRun: withRows, running: true });
    await userEvent.click(screen.getByRole('button', { name: 'Export results' }));
    const disabled = (await screen.findAllByRole('menuitem')).map((i) => i.hasAttribute('disabled'));
    expect(disabled).toEqual([false, false, true, true]);
  });

  it('exports the full run while a stage is selected', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({
      lastRun: { ...runMeta, rows: [{ _id: 'final' }], durationMs: 3, stageSamples: { 4: [{ _id: 'sample' }] } },
      stage: previewStage({ id: 4 }),
    });

    fireEvent.click(await exportItem('Copy'));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0]).toEqual([expect.stringContaining('final')]);
  });
});

function previewStage(over: Partial<PreviewStage> = {}): PreviewStage {
  return { id: 4, index: 1, op: '$group', enabled: true, stale: false, loading: false, ...over };
}

describe('OutputPanel — the selected stage', () => {
  it('shows the stage sample, its heading and count, not the full output', () => {
    renderPanel({
      view: 'JSON',
      lastRun: {
        ...runMeta,
        rows: [{ _id: 'final' }],
        durationMs: 3,
        stageCounts: { 4: 12 },
        stageSamples: { 4: [{ _id: 'sample' }] },
      },
      stage: previewStage(),
    });
    expect(screen.getByTestId('preview-heading').textContent).toBe('Stage 2 · $group · 12 docs');
    const body = screen.getByTestId('output-bar').nextElementSibling as HTMLElement;
    expect(body.textContent).toContain('sample');
    expect(body.textContent).not.toContain('final');
  });

  it('offers Run up to this stage for a stage never run, and runs nothing by itself', () => {
    const onRunToStage = vi.fn();
    const onRun = vi.fn();
    renderPanel({ stage: previewStage(), onRunToStage, onRun });
    expect(screen.getByText('This stage has not been run yet')).toBeTruthy();
    expect(onRunToStage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Run up to this stage' }));
    expect(onRunToStage).toHaveBeenCalledWith(4);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('shows the shortcut beside the action without putting it in the name', () => {
    renderPanel({ stage: previewStage() });
    const button = screen.getByRole('button', { name: 'Run up to this stage' });
    expect(button.textContent).toMatch(/↵|Enter/);
  });

  it('says so while the stage runs, and for a turned-off stage', () => {
    const { unmount } = renderPanel({ stage: previewStage({ loading: true }) });
    expect(screen.getByText('Running up to stage 2…')).toBeTruthy();
    unmount();
    renderPanel({ stage: previewStage({ enabled: false }) });
    expect(screen.getByText('Stage 2 is turned off')).toBeTruthy();
  });

  it('marks a stage edited after its sample as stale', () => {
    renderPanel({
      lastRun: { ...runMeta, rows: [], durationMs: 0, stageSamples: { 4: [{ _id: 1 }] } },
      stage: previewStage({ stale: true }),
    });
    expect(screen.getByTitle('Stage edited after last run').textContent).toContain('stale');
  });

  it('refreshes a stage sample from the header', () => {
    const onRunToStage = vi.fn();
    renderPanel({
      lastRun: { ...runMeta, rows: [], durationMs: 0, stageSamples: { 4: [{ _id: 1 }] } },
      stage: previewStage(),
      onRunToStage,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(onRunToStage).toHaveBeenCalledWith(4);
  });
});

describe('OutputPanel — Run unavailable', () => {
  it('an empty pipeline says what to do, with no Run to press', () => {
    renderPanel({ runBlockedReason: 'Add a stage to run' });
    expect(screen.getByText('Add a stage to run')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run pipeline' })).toBeNull();
  });

  it('with output already shown, states the reason above it', () => {
    renderPanel({
      lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 1 },
      runBlockedReason: 'Fix stage 1 to run: body is empty',
    });
    expect(screen.getByTestId('run-blocked-reason').textContent).toBe('Fix stage 1 to run: body is empty');
  });

  it('states nothing when Run is available', () => {
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 1 } });
    expect(screen.queryByTestId('run-blocked-reason')).toBeNull();
  });
});

describe('OutputPanel — stacking toggle', () => {
  it('is a pressed-state toggle that calls back', () => {
    const onToggleStacked = vi.fn();
    renderPanel({ stacked: true, onToggleStacked });
    const toggle = screen.getByRole('button', { name: 'Stack preview under stages' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(toggle);
    expect(onToggleStacked).toHaveBeenCalledOnce();
  });

  it('is absent while the window is too narrow to choose', () => {
    renderPanel({ stacked: true, onToggleStacked: undefined });
    expect(screen.queryByRole('button', { name: 'Stack preview under stages' })).toBeNull();
  });
});

describe('OutputPanel bar', () => {
  function giveBarWidth(width: number) {
    const native = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      return this.matches('[data-testid="output-bar"]') ? ({ width } as DOMRect) : native.call(this);
    });
  }
  const lastRun: AggregationLastRun = { ...runMeta, rows: [{ _id: 1 }], durationMs: 3 };

  it('in a narrow column, Export results is its icon and keeps its name', async () => {
    giveBarWidth(380);
    const onSaveAsView = vi.fn();
    renderPanel({ lastRun, onSaveAsView });
    const trigger = screen.getByRole('button', { name: 'Export results' });
    expect(trigger.textContent).toBe('');
    expect(screen.getByTestId('preview-heading').textContent).toBe('Output');

    fireEvent.click(await exportItem('Create view…'));
    expect(onSaveAsView).toHaveBeenCalledOnce();
  });

  it('with room, Export results is labelled and the count shows', () => {
    giveBarWidth(800);
    renderPanel({ lastRun });
    expect(screen.getByRole('button', { name: 'Export results' }).textContent).toBe('Export results');
    expect(screen.getByTestId('preview-heading').textContent).toBe('Output · 1 docs · 3 ms');
  });

  it('holds the heading slot before any run, so a first run moves no control', () => {
    renderPanel();
    const slot = screen.getByTestId('preview-heading');
    expect(slot.style.flexGrow).toBe('1');
    expect(slot.style.minWidth).toBe('0px');
    expect(slot.style.textOverflow).toBe('ellipsis');
  });
});
