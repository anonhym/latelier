import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { Inspector, type PlanRequest } from '../../src/pages/Workspace/Inspector';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';
import { installAtelierMock } from '../helpers/atelierMock';

const COLLSCAN = { queryPlanner: { winningPlan: { stage: 'COLLSCAN' } } };

function stateOf(queryRaw: string): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw,
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

/** Holds the filter text in real state, so an edit reaches the open Inspector as new props. */
function Stateful({ plan, openCreateIndex }: { plan: PlanRequest; openCreateIndex: () => void }) {
  const [queryRaw, setQueryRaw] = React.useState('{"sku":"a"}');
  return (
    <>
      <button type="button" onClick={() => setQueryRaw('{"sku":"b"}')}>
        edit filter
      </button>
      <CollectionWorkspaceProvider
        state={stateOf(queryRaw)}
        actions={emptyWorkspaceActions({ openCreateIndex: openCreateIndex as never })}
        meta={emptyWorkspaceMeta()}
      >
        <Inspector tab="plan" onTabChange={() => {}} onClose={() => {}} plan={plan}>
          <span />
        </Inspector>
      </CollectionWorkspaceProvider>
    </>
  );
}

const plan: PlanRequest = { tabId: 't1', seq: 1, verbosity: 'queryPlanner', plan: COLLSCAN };

describe('Inspector plan staleness', () => {
  it('marks the plan stale and withdraws Create index once the filter is edited', async () => {
    installAtelierMock({});
    render(<Stateful plan={plan} openCreateIndex={vi.fn()} />);
    await screen.findByTestId('explain-create-index');
    expect(screen.queryByText(/This plan is not current/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'edit filter' }));

    expect(await screen.findByText(/This plan is not current/)).toBeTruthy();
    expect(screen.queryByTestId('explain-create-index')).toBeNull();
  });

  it('Create index suggests for the explained query while it is current', async () => {
    installAtelierMock({});
    const openCreateIndex = vi.fn();
    render(<Stateful plan={plan} openCreateIndex={openCreateIndex} />);

    fireEvent.click(await screen.findByTestId('explain-create-index'));

    await waitFor(() => expect(openCreateIndex).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(openCreateIndex.mock.calls[0])).toContain('sku');
  });

  it('a refetch after the edit makes the plan current again', async () => {
    const explain = vi.fn(async () => ({ plan: COLLSCAN, verbosity: 'executionStats' }));
    installAtelierMock({ query: { explain: explain as never } });
    render(<Stateful plan={plan} openCreateIndex={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'edit filter' }));
    await screen.findByText(/This plan is not current/);

    fireEvent.change(screen.getByLabelText('Verbosity'), { target: { value: 'executionStats' } });

    await waitFor(() => expect(explain).toHaveBeenCalled());
    expect((explain.mock.calls[0] as unknown[])[0]).toMatchObject({ filter: '{"sku":"b"}' });
    await waitFor(() => expect(screen.queryByText(/This plan is not current/)).toBeNull());
  });
});
