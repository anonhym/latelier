import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionWorkspaceMeta } from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

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

  it('Running… keeps the band height', () => {
    const { container } = renderBar(vi.fn(), { isLoading: true });
    expect(container.textContent).toContain('Running…');
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
