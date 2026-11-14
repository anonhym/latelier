import { describe, it, expect } from 'vitest';
import { render, screen, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { ResultBar } from '../../src/pages/Workspace/ResultBar';
import { QueryBar } from '../../src/pages/Workspace/QueryBar';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState, ResultViewMode } from '@shared/types';

function makeState(view: ResultViewMode): CollectionTabState {
  return {
    view,
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: {
      documents: [{ _id: 1, name: 'alpha' }],
      durationMs: 5,
      ranAt: new Date().toISOString(),
    },
  };
}

function renderBars(view: ResultViewMode) {
  return render(
    <CollectionWorkspaceProvider
      state={makeState(view)}
      actions={emptyWorkspaceActions()}
      meta={emptyWorkspaceMeta()}
    >
      <QueryBar suggestionContext={null} />
      <div data-testid="result-bar-host">
        <ResultBar />
      </div>
    </CollectionWorkspaceProvider>,
  );
}

// The field chooser is the Filter Bar row's Project pill, one list for every
// view. It used to sit in the result toolbar, and before that only in Table.
describe('Project pill — where the fields are chosen', () => {
  it.each(['Tree', 'JSON', 'Table'] as const)('is in the Filter Bar row in the %s view, not the result toolbar', (view) => {
    renderBars(view);
    expect(within(screen.getByTestId('filter-bar-row')).getByRole('button', { name: 'Project' })).toBeTruthy();
    expect(within(screen.getByTestId('result-bar-host')).queryByRole('button', { name: /fields|project/i })).toBeNull();
  });
});
