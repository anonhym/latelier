import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

/**
 * jsdom has no layout: this gives the result bar and its count
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
      actions={emptyWorkspaceActions({ openPlan: vi.fn() })}
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
  return [form(/^Insert document/)];
}

beforeEach(() => installAtelierMock());
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('ResultBar collapses by width alone', () => {
  it.each([
    [669, 'label'],
    [668, 'icon'],
  ])('at %i px every state keeps the same control forms', (width, form) => {
    giveBarWidth(width);
    const { rerender } = render(bar(barState()));
    const fresh = controlForms();
    expect(fresh.every((f) => f.endsWith(`:${form}`))).toBe(true);

    rerender(bar(barState({ queryRaw: '{ bad:' })));
    expect(screen.getByTestId('result-count-stale').getAttribute('aria-label')).toBe('Not current');
    expect(controlForms()).toEqual(fresh);

    rerender(bar(barState(), true));
    expect(controlForms()).toEqual(fresh);

    // A new result with a total as long as the old one: only a longer or shorter total
    // changes the pager label's width, and so the step.
    rerender(bar(barState({ totalCount: 99 })));
    expect(controlForms()).toEqual(fresh);
  });

  it('icon-only controls keep their accessible names', () => {
    giveBarWidth(319);
    render(bar(barState()));
    const root = screen.getByTestId('result-bar');
    for (const name of ['Insert document', 'More actions']) {
      const b = within(root).getByRole('button', { name });
      expect(b.querySelector('svg')).not.toBeNull();
    }
  });

  it('Table, Tree and JSON show their words while there is room, in that order', () => {
    giveBarWidth(700);
    render(bar(barState()));
    const views = within(screen.getByRole('radiogroup')).getAllByRole('radio').map((r) => r.getAttribute('value'));
    expect(views).toEqual(['Table', 'Tree', 'JSON']);
    for (const view of ['Tree', 'JSON', 'Table']) expect(screen.getByText(view)).toBeTruthy();
  });

  it('at the narrowest pane the view switch is icons, and each radio keeps its name', () => {
    giveBarWidth(320);
    render(bar(barState()));
    const group = within(screen.getByRole('radiogroup'));
    expect(group.getAllByRole('radio').map((r) => r.getAttribute('value'))).toEqual(['Table', 'Tree', 'JSON']);
    for (const name of ['Table', 'Tree', 'JSON']) expect(group.getByRole('radio', { name })).toBeTruthy();
    expect(screen.getByTestId('result-bar').querySelectorAll('[class*="SegmentedControl-label"] svg')).toHaveLength(3);
  });

  it.each([
    [320],
    [200],
    [150],
  ])('at a %i px count the count reads "60 documents · 2 ms", the range left to the pager', (width) => {
    giveCountWidth(width);
    render(bar(barState()));
    const slot = screen.getByTestId('result-count-slot');
    expect(slot.textContent).toMatch(/^60 documents · 2 ms/);
    expect(slot.textContent).not.toMatch(/of 60/);
  });

  it('the narrowest count keeps the noun and the duration, and marks a stale result with a dot', () => {
    giveCountWidth(150);
    render(bar(barState({ queryRaw: '{ bad:' })));
    const slot = screen.getByTestId('result-count-slot');
    expect(slot.textContent).toBe('60 documents · 2 ms');
    const dot = within(slot).getByRole('img', { name: 'Not current' });
    expect(dot.textContent).toBe('');
  });

  it('a current result carries no stale mark', () => {
    giveCountWidth(150);
    render(bar(barState()));
    expect(screen.queryByTestId('result-count-stale')).toBeNull();
  });

  it('everything that depends on the query sits in the result bar\'s flexible slot', () => {
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
    expect(screen.getByTestId('result-bar').contains(slot)).toBe(true);
    expect(screen.getByTestId('status-bar').contains(slot)).toBe(false);
  });

  it('the result bar is one 28px row at the narrowest pane, and the pager keeps Previous, Next and its label', () => {
    giveBarWidth(320);
    render(bar(barState()));
    const header = screen.getByTestId('result-bar');
    expect(header.style.height).toBe('28px');
    expect(header.style.getPropertyValue('--group-wrap')).toBe('nowrap');
    for (const name of ['Previous page', 'Next page']) expect(within(header).getByRole('button', { name })).toBeTruthy();
    expect(within(header).getByTestId('page-label').textContent).toBe('1–50 of 60');
    expect(within(header).queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'First page' })).toBeNull();
    expect(within(header).queryByRole('button', { name: 'Last page' })).toBeNull();
    expect(within(screen.getByTestId('status-bar')).queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('the pager has First and Last from 535 px', () => {
    giveBarWidth(535);
    render(bar(barState()));
    const header = screen.getByTestId('result-bar');
    for (const name of ['First page', 'Last page']) expect(within(header).getByRole('button', { name })).toBeTruthy();
  });

  it('below 535 px First and Last go, and the page size stays down to 435 px', () => {
    giveBarWidth(534);
    render(bar(barState()));
    expect(within(screen.getByTestId('result-bar')).queryByRole('button', { name: 'First page' })).toBeNull();
    expect(within(screen.getByTestId('result-bar')).getByRole('combobox', { name: 'Rows per page' })).toBeTruthy();
  });

  it('the page size hides below 435 px', () => {
    giveBarWidth(434);
    render(bar(barState()));
    expect(within(screen.getByTestId('result-bar')).queryByRole('combobox', { name: 'Rows per page' })).toBeNull();
  });
});
