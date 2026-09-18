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
  // JsonView's card click toggles selection; clicking the rendered "alpha"
  // text bubbles up to the card's own onClick handler.
  fireEvent.click(screen.getByText('"alpha"'));
}

describe('SelectionActionBar', () => {
  it('AC1 — renders nothing when no rows are selected', () => {
    const { container } = renderBar(vi.fn());
    expect(container.textContent).not.toContain('selected');
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
    fireEvent.click(screen.getByText('"no-id-doc"'));
    const deleteButton = container.querySelector(
      '[data-testid="selection-bar-delete"]',
    ) as HTMLButtonElement;
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(deleteButton);
    expect(onDeleteSelected).not.toHaveBeenCalled();
  });
});
