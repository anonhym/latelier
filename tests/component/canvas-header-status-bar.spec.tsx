import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { installAtelierMock, uninstallAtelierMock, connectionFixture } from '../helpers/atelierMock';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { StatusBar } from '../../src/pages/Workspace/StatusBar';
import { ResultViewer } from '../../src/pages/Workspace/ResultViewer';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { DEFAULT_VIEW_PREF_KEY } from '../../src/state/workspaceTabs';
import type { CollectionTabState, ConnectionSummary } from '@shared/types';

function state(over: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    totalCount: 120,
    lastRun: { documents: new Array(50).fill({}), durationMs: 4, ranAt: '2026-01-01T00:00:00.000Z' },
    ...over,
  };
}

function mount(over: Partial<CollectionTabState> = {}, connection: ConnectionSummary | null = null) {
  const actions = emptyWorkspaceActions();
  render(
    <CollectionWorkspaceProvider state={state(over)} actions={actions} meta={emptyWorkspaceMeta()}>
      <ResultBar />
      <StatusBar connection={connection} />
    </CollectionWorkspaceProvider>,
  );
  return { actions };
}

let prefsSet: ReturnType<typeof vi.fn>;
beforeEach(() => {
  prefsSet = vi.fn(async () => undefined);
  installAtelierMock({ prefs: { set: prefsSet } as never });
});
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('canvas header', () => {
  it('choosing a view patches the tab and makes it the default for new tabs', async () => {
    const { actions } = mount();
    fireEvent.click(screen.getByText('JSON'));
    expect(actions.patch).toHaveBeenCalledWith({ view: 'JSON' });
    await waitFor(() => expect(prefsSet).toHaveBeenCalledWith(DEFAULT_VIEW_PREF_KEY, 'JSON'));
  });

  it('`⋯` holds Bulk actions and Data, each in its group', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    const rows = [...menu.querySelectorAll('.mantine-Menu-label, [role="menuitem"]')].map((el) => el.textContent);
    expect(rows).toEqual(['Bulk actions', 'Update matching…', 'Delete matching…', 'Data', 'Export…', 'Import…']);
  });

  it('Insert is an outline button, not a filled one', () => {
    mount();
    expect(screen.getByRole('button', { name: 'Insert document' }).getAttribute('data-variant')).toBe('default');
  });
});

describe('status bar', () => {
  it('states the Connection, host and version while connected, with a Read-only badge', () => {
    mount({}, connectionFixture({ name: 'Prod', host: 'db.example', status: 'connected', serverVersion: '7.0.2', readOnly: true }));
    const left = screen.getByTestId('status-connection');
    expect(left.textContent).toBe('Prod · db.example · v7.0.2Read-only');
    expect(within(left).getByRole('img', { name: 'Connected' })).toBeTruthy();
  });

  it('leaves the version out while not connected', () => {
    mount({}, connectionFixture({ name: 'Prod', host: 'db.example', status: 'unknown', serverVersion: '7.0.2' }));
    expect(screen.getByTestId('status-connection').textContent).toBe('Prod · db.example');
  });

  it('holds the count and the pager, and the pager drives the tab', () => {
    const { actions } = mount();
    const bar = screen.getByTestId('status-bar');
    expect(within(bar).getByTestId('result-count-slot').textContent).toMatch(/120 results/);
    fireEvent.click(within(bar).getByRole('button', { name: 'Next page' }));
    expect(actions.patch).toHaveBeenCalledWith({ page: 1 });
    expect(actions.run).toHaveBeenCalledWith({ page: 1 });
  });

  it.each([
    ['First page', 'Already on the first page'],
    ['Previous page', 'Already on the first page'],
  ])('a disabled %s says why', async (name, reason) => {
    mount();
    const button = screen.getByRole('button', { name });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.mouseEnter(button.parentElement!);
    expect(await screen.findByText(reason)).toBeTruthy();
  });

  it.each(['Next page', 'Last page'])('a disabled %s on the last page says there are no more results', async (name) => {
    mount({ page: 2 });
    fireEvent.mouseEnter(screen.getByRole('button', { name }).parentElement!);
    expect(await screen.findByText('No more results')).toBeTruthy();
  });

  it('an enabled pager button names itself', async () => {
    mount();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Last page' }).parentElement!);
    expect((await screen.findByRole('tooltip')).textContent).toBe('Last page');
  });
});

describe('Expand document tooltips', () => {
  it.each([
    ['Tree', 'Expand document (Space)'],
    ['Table', 'Expand document'],
  ] as const)('the %s view names its expand control on hover', async (view, tooltip) => {
    render(
      <CollectionWorkspaceProvider
        state={state({ view, lastRun: { documents: [{ _id: 1, a: { b: 1 } }], durationMs: 1, ranAt: '2026-01-01T00:00:00.000Z' } })}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta()}
      >
        <ResultViewer>
          <ResultViewer.Body onClearFilter={() => {}} onColumnResize={() => {}} onRowExpand={() => {}} />
        </ResultViewer>
      </CollectionWorkspaceProvider>,
    );
    fireEvent.mouseEnter(screen.getAllByRole('button', { name: 'Expand document' })[0]!);
    expect((await screen.findByRole('tooltip')).textContent).toBe(tooltip);
  });
});
