import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
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

function renderJson(docs: unknown[]) {
  return render(
      <CollectionWorkspaceProvider
        state={emptyState()}
        actions={emptyWorkspaceActions()}
        meta={emptyWorkspaceMeta()}
      >
        <JsonView documents={docs} />
      </CollectionWorkspaceProvider>
  );
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
