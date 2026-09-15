import { describe, it, expect, afterEach, vi } from 'vitest';
import { render } from '../helpers/render';
import { TableView } from '../../src/pages/Workspace/views/TableView';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import type {
  CollectionWorkspaceActions,
  CollectionWorkspaceMeta,
} from '../../src/pages/Workspace/context';
import type { CollectionTabState } from '@shared/types';

/**
 * `widths` (built in the same render, from `columnsProp`/live-drag state
 * keyed by field name) is read with `widths[col.field] ?? 160` at
 * `:615`/`:945`/`:1138`.
 *
 * Most `Object.prototype` member names (`constructor`, `toString`, …) are
 * plain *data* properties there, so `out[field] = value` for one of those
 * just creates a normal own key that shadows the prototype — no bug,
 * confirmed empirically. `__proto__` is the one member that's an *accessor*
 * (Annex B): `out['__proto__'] = 160` (a primitive, not an object or null)
 * hits that setter and is a no-op — no own key is created — so the later
 * read falls through to the inherited `__proto__` *getter*, which returns
 * `Object.prototype` itself: an object, so `?? 160` doesn't rescue it either.
 *
 * This doesn't throw the way an earlier truthy-guard bug in a sibling map
 * did — React stringifies the returned object into the `style.width` inline
 * style
 * (`"[object Object]"`), and jsdom (like a real browser) rejects that as an
 * invalid CSS length, silently leaving `style.width` as `""` instead of the
 * intended `160px` fallback. Confirmed empirically before writing this
 * assertion (a `?? 160` bug that produced `NaN` would have been the wrong
 * claim — the arithmetic here is string concatenation, not `NaN` — so this
 * asserts the per-column style directly rather than a corrupted
 * `totalWidth`).
 *
 * The doc is built via `JSON.parse`, not an object literal: a literal
 * `{ __proto__: 'x' }` sets the prototype at construction time instead of
 * creating an own property, which would silently defeat this test.
 *
 * The write (`ownSet` in the builder) and each read (`ownGet` at the three
 * sites) are a matched pair, not independent guards: once either half of a
 * pair is fixed, the other is masked — a fixed `ownSet` write leaves a real
 * own key for even a plain bracket read to find; a fixed `ownGet` read
 * treats a missing own key (the no-op write's actual result) as absent and
 * falls back to 160 regardless. Reverting only one half of a pair does not
 * fail this test; reverting the builder together with a given read does.
 */

function emptyState(): CollectionTabState {
  return {
    view: 'Table',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
  };
}

function emptyActions(): CollectionWorkspaceActions {
  return {
    patch: vi.fn(),
    patchWith: vi.fn(),
    run: vi.fn(),
    openEdit: vi.fn(),
    openDelete: vi.fn(),
    openDeleteAll: vi.fn(),
    openInsert: vi.fn(),
    openSave: vi.fn(),
  };
}

function emptyMeta(): CollectionWorkspaceMeta {
  return {
    connectionId: 'c1',
    dbName: 'app',
    collection: 'orders',
    tabId: 't1',
    isLoading: false,
  };
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <CollectionWorkspaceProvider state={emptyState()} actions={emptyActions()} meta={emptyMeta()}>
      {children}
    </CollectionWorkspaceProvider>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TableView — widths keyed by a "__proto__" field', () => {
  it('falls back to the 160px default column width instead of the inherited Object.prototype', () => {
    const doc = JSON.parse('{"_id":"d1","__proto__":"shadowed value"}') as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(doc, '__proto__')).toBe(true);

    const { container } = render(
      <Wrap>
        <TableView documents={[doc]} onColumnResize={vi.fn()} expandedRows={{}} onRowExpand={vi.fn()} />
      </Wrap>,
    );

    // Header cell width (`:1138`).
    const header = container.querySelector('[data-testid="table-header-__proto__"]') as HTMLElement;
    expect(header).not.toBeNull();
    expect(header.style.width).toBe('160px');

    // Header row's `minWidth`, driven by `totalWidth`'s `columns.reduce`
    // over the same map (`:945`). Same failure mode: the reduce would add
    // the inherited `Object.prototype` object into the running sum via `+`,
    // stringifying it into `totalWidth`, which then fails the same jsdom
    // CSS-length rejection as the per-column width above.
    const headerRow = header.parentElement as HTMLElement;
    expect(headerRow.style.minWidth).not.toBe('');

    // Body cell width (`:615`) — identified by its drag-to-filter `title`,
    // which embeds the field path (no dedicated testid on the cell itself).
    const cell = Array.from(container.querySelectorAll<HTMLElement>('[title]')).find((el) =>
      el.title.includes('"__proto__ $eq'),
    );
    expect(cell).not.toBeUndefined();
    expect(cell!.style.width).toBe('160px');
  });
});
