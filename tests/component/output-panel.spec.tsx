import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '../helpers/render';
import { OutputPanel } from '../../src/pages/Workspace/Aggregation/OutputPanel';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { notifications } from '@mantine/notifications';
import type { AggregationLastRun, ResultViewMode } from '@shared/types';

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

function renderPanel(
  overrides: {
    view?: ResultViewMode;
    lastRun?: AggregationLastRun | undefined;
    running?: boolean;
    onViewChange?: (v: ResultViewMode) => void;
    onSaveAsCollection?: () => void;
  } = {},
) {
  return render(
      <OutputPanel
        height={260}
        view={overrides.view ?? 'Tree'}
        lastRun={overrides.lastRun}
        running={overrides.running ?? false}
        pipelineName={null}
        onHeightChange={vi.fn()}
        onHeightCommit={vi.fn()}
        onViewChange={overrides.onViewChange ?? vi.fn()}
        onSaveAsCollection={overrides.onSaveAsCollection ?? vi.fn()}
      />
  );
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
    expect(container.textContent).toContain('42ms');
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
    expect(alert.textContent).toContain('pipeline blew up');
  });

  it('invokes onViewChange when the user clicks a view button', () => {
    const onViewChange = vi.fn();
    renderPanel({ view: 'Tree', onViewChange });
    fireEvent.click(screen.getByText('JSON'));
    expect(onViewChange).toHaveBeenCalledWith('JSON');
    fireEvent.click(screen.getByText('Table'));
    expect(onViewChange).toHaveBeenLastCalledWith('Table');
  });

  it('disables copy / save / download when there are no rows', () => {
    renderPanel({ lastRun: { ...runMeta, rows: [], durationMs: 5 } });
    const copyBtn = screen.getByText('Copy').closest('button')!;
    const saveBtn = screen.getByText('Save as…').closest('button')!;
    expect(copyBtn.hasAttribute('disabled')).toBe(true);
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
  });

  // Copy used to `.catch(() => {})`, so a denied clipboard was
  // indistinguishable from a successful copy.
  it('reports a copied output', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(screen.getByText('Copy').closest('button')!);

    await screen.findByText(/Output copied to the clipboard/);
  });

  it('reports a rejected copy rather than claiming success', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied'); });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPanel({ lastRun: { ...runMeta, rows: [{ _id: 1 }], durationMs: 5 } });

    fireEvent.click(screen.getByText('Copy').closest('button')!);

    await screen.findByText(/Could not copy to the clipboard/);
    expect(screen.queryByText(/Output copied to the clipboard/)).toBeNull();
  });

  it('shows the Running… overlay when running is true', () => {
    const { container } = renderPanel({ running: true, lastRun: { ...runMeta, rows: [], durationMs: 0 } });
    expect(container.textContent).toContain('Running');
  });
});
