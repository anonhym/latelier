import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, within, emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { JsonView } from '../../src/pages/Workspace/views/JsonView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type { CollectionTabState } from '@shared/types';

let originalClipboard: Clipboard | undefined;
beforeEach(() => {
  originalClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => undefined) },
    configurable: true,
  });
});
afterEach(() => {
  // Always restore: if `originalClipboard` was undefined (jsdom default),
  // delete our injected property so the mocked clipboard doesn't leak into
  // later tests in the same worker.
  if (originalClipboard !== undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    });
  } else {
    delete (navigator as { clipboard?: Clipboard }).clipboard;
  }
});

function emptyState(): CollectionTabState {
  return {
    view: 'JSON',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

function renderJson(
  docs: unknown[],
  overrides?: { state?: Partial<CollectionTabState>; actions?: ReturnType<typeof emptyWorkspaceActions> },
) {
  const actions = overrides?.actions ?? emptyWorkspaceActions();
  return {
    ...render(
      <CollectionWorkspaceProvider
        state={{ ...emptyState(), ...overrides?.state }}
        actions={actions}
        meta={emptyWorkspaceMeta()}
      >
        <JsonView documents={docs} />
      </CollectionWorkspaceProvider>
    ),
    actions,
  };
}

/**
 * P1-11 coverage for JsonView. Smoke-tests document rendering and the
 * EJSON-aware serialization (BSON typed values must surface their sentinel
 * form in the JSON pretty-print).
 */
describe('JsonView — rendering', () => {
  it('renders one card per document with the document keys visible', () => {
    const docs = [
      { _id: 1, name: 'alpha' },
      { _id: 2, name: 'beta' },
    ];
    const { container } = renderJson(docs);
    expect(container.textContent).toContain('alpha');
    expect(container.textContent).toContain('beta');
    expect(container.textContent).toContain('name');
  });

  it('serializes BSON-typed values using canonical EJSON sentinels', () => {
    const docs = [
      {
        _id: { $oid: '507f1f77bcf86cd799439011' },
        createdAt: { $date: { $numberLong: '1735689600000' } },
      },
    ];
    const { container } = renderJson(docs);
    // EJSON canonical output must surface the type tags as text.
    expect(container.textContent).toContain('$oid');
    expect(container.textContent).toContain('$date');
  });

  it('the Select button carries no nested interactive controls (nested-interactive / S6852)', () => {
    const docs = [{ _id: 1, name: 'alpha' }];
    renderJson(docs);
    const selectBtn = screen.getByRole('button', { name: 'Select document' });
    expect(within(selectBtn).queryAllByRole('button')).toHaveLength(0);
  });
});

/**
 * JSON honors the Fields control's hidden top-level fields.
 */
describe('JsonView — hidden fields', () => {
  it('omits a hidden top-level field from the rendered JSON', () => {
    const docs = [{ _id: 1, name: 'alpha', secret: 'shh' }];
    const { container } = renderJson(docs, {
      state: { columnConfig: { hidden: ['secret'] } },
    });
    expect(container.textContent).toContain('name');
    expect(container.textContent).not.toContain('secret');
    expect(container.textContent).not.toContain('shh');
  });

  it('shows a "N fields hidden" note reflecting the hidden count', () => {
    const docs = [{ _id: 1, name: 'alpha', secret: 'shh', other: 1 }];
    const { container } = renderJson(docs, {
      state: { columnConfig: { hidden: ['secret', 'other'] } },
    });
    expect(container.textContent).toContain('2 fields hidden');
  });

  it('shows no hidden-fields note when nothing is hidden', () => {
    const docs = [{ _id: 1, name: 'alpha' }];
    const { container } = renderJson(docs);
    expect(container.textContent).not.toContain('field hidden');
    expect(container.textContent).not.toContain('fields hidden');
  });

  it('still hands the FULL document (including hidden fields) to Edit', async () => {
    const docs = [{ _id: 1, name: 'alpha', secret: 'shh' }];
    const { actions } = renderJson(docs, {
      state: { columnConfig: { hidden: ['secret'] } },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(actions.openEdit).toHaveBeenCalledWith(docs[0]);
  });

  it('still copies the FULL document (including hidden fields)', async () => {
    const docs = [{ _id: 1, name: 'alpha', secret: 'shh' }];
    renderJson(docs, { state: { columnConfig: { hidden: ['secret'] } } });
    await userEvent.click(screen.getByRole('button', { name: 'Copy JSON' }));
    const written = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(written).toContain('secret');
    expect(written).toContain('shh');
  });
});
