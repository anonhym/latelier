import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

/**
 * jsdom has no layout: this gives the canvas header and the status bar's count
 * their own widths, and nothing else one.
 */
function giveWidths(header: number, count = 1000) {
  const native = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
    if (this.matches('[data-testid="result-bar"]')) return { width: header } as DOMRect;
    if (this.matches('[data-testid="result-count-slot"]')) return { width: count } as DOMRect;
    return native.call(this);
  });
}
const giveBarWidth = (width: number) => giveWidths(width);
const giveCountWidth = (width: number) => giveWidths(1000, width);

const RUN = { documents: new Array(50).fill({}), durationMs: 2, ranAt: '2026-01-01T00:00:00.000Z' };

function barState(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    totalCount: 60,
    lastRun: RUN,
    ...over,
  };
}

function bar(state: CollectionTabState, isLoading = false) {
  return (
    <CollectionWorkspaceProvider
      state={state}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta({ isLoading })}
    >
      <StatusBar connection={null} />
      <ResultBar />
    </CollectionWorkspaceProvider>
  );
}

/** Each named control's accessible name, and whether it shows words or only an icon. */
function controlForms() {
  const root = screen.getByTestId('result-bar');
  const form = (name: RegExp) => {
    const b = within(root).getByRole('button', { name });
    return `${b.getAttribute('aria-label') ?? b.textContent}:${b.classList.contains('mantine-ActionIcon-root') ? 'icon' : 'label'}`;
  };
  return [form(/^Fields/), form(/^Insert document/)];
}

beforeEach(() => installAtelierMock());
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('ResultBar collapses by width alone', () => {
  it.each([
    [400, 'label'],
    [399, 'icon'],
  ])('at %i px every state keeps the same control forms', (width, form) => {
    giveBarWidth(width);
    const { rerender } = render(bar(barState()));
    const fresh = controlForms();
    expect(fresh.every((f) => f.endsWith(`:${form}`))).toBe(true);

    rerender(bar(barState({ queryRaw: '{ bad:' })));
    expect(screen.getByTestId('result-count-stale').textContent).toContain('not current');
    expect(controlForms()).toEqual(fresh);

    rerender(bar(barState(), true));
    expect(controlForms()).toEqual(fresh);

    rerender(bar(barState({ lastRun: undefined, totalCount: undefined })));
    expect(controlForms()).toEqual(fresh);

    rerender(bar(barState({ lastRun: { ...RUN, documents: new Array(3).fill({}) }, totalCount: 3 })));
    expect(controlForms()).toEqual(fresh);
  });

  it('icon-only controls keep their accessible names', () => {
    giveBarWidth(399);
    render(bar(barState()));
    const root = screen.getByTestId('result-bar');
    for (const name of ['Fields', 'Insert document', 'More actions']) {
      const b = within(root).getByRole('button', { name });
      expect(b.querySelector('svg')).not.toBeNull();
    }
  });

  it('marks a changed Fields view on the icon, so it does not hide behind a click', () => {
    giveBarWidth(399);
    const { rerender } = render(bar(barState()));
    expect(screen.queryByTestId('fields-changed-mark')).toBeNull();
    rerender(bar(barState({ columnConfig: { hidden: ['a'] } })));
    expect(screen.getByTestId('fields-changed-mark')).toBeTruthy();
  });

  it('Table, Tree and JSON keep their words at every width, in that order', () => {
    giveBarWidth(320);
    render(bar(barState()));
    const views = within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.getAttribute('value'));
    expect(views).toEqual(['Table', 'Tree', 'JSON']);
    for (const view of ['Tree', 'JSON', 'Table']) expect(screen.getByText(view)).toBeTruthy();
  });

  it.each([
    [320, /60 results/, /showing 1–50/],
    [200, /1–50 of 60/, /^$/],
    [150, /60 results/, /^$/],
  ])('at a %i px count the count merges, with the rest in a tooltip', (width, shown, also) => {
    giveCountWidth(width);
    render(bar(barState()));
    const slot = screen.getByTestId('result-count-slot');
    expect(slot.textContent).toMatch(shown);
    if (also.source !== '^$') expect(slot.textContent).toMatch(also);
    else expect(slot.querySelector('[title*="showing 1–50"]')).not.toBeNull();
  });

  it('the narrowest count spends its room on "not current" rather than the noun', () => {
    giveCountWidth(150);
    render(bar(barState({ queryRaw: '{ bad:' })));
    expect(screen.getByTestId('result-count-slot').textContent).toBe('60· not current');
  });

  it('everything that depends on the query sits in the status bar\'s flexible slot, not in the canvas header', () => {
    giveCountWidth(320);
    render(
      bar(
        barState({
          queryRaw: '{ bad:',
          builder: { projection: [], sort: '', limit: '10' },
          lastRun: { ...RUN, plan: { queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: 'status_1' } } } } as never,
        }),
      ),
    );
    const slot = screen.getByTestId('result-count-slot');
    expect(slot.style.flexGrow).toBe('1');
    expect(slot.style.minWidth).toBe('0px');
    expect(slot.contains(screen.getByTestId('result-count-stale'))).toBe(true);
    expect(slot.contains(screen.getByTestId('result-limit-cap'))).toBe(true);
    expect(slot.contains(screen.getByTestId('plan-badge'))).toBe(true);
    expect(screen.getByTestId('status-bar').contains(slot)).toBe(true);
    expect(screen.getByTestId('result-bar').contains(slot)).toBe(false);
  });

  it('the canvas header is one 28px row at the narrowest pane, with no pager in it', () => {
    giveBarWidth(320);
    render(bar(barState()));
    const header = screen.getByTestId('result-bar');
    expect(header.style.height).toBe('28px');
    expect(header.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    expect(within(header).queryByRole('button', { name: 'Next page' })).toBeNull();
    expect(within(screen.getByTestId('status-bar')).getByRole('button', { name: 'Next page' })).toBeTruthy();
  });
});
