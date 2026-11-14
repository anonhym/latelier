import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CollectionWorkspaceProvider } from '../../src/pages/Workspace/CollectionWorkspaceProvider';
import { StructureViewConnected } from '../../src/pages/Workspace/StructureViewConnected';
import { emptyWorkspaceActions, emptyWorkspaceMeta } from '../helpers/render';
import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';
import Workspace from '../../src/pages/Workspace';
import { StructureView } from '../../src/pages/Workspace/StructureView';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { notifyCollectionChanged } from '../../src/state/collectionChanges';
import { schemaEnumSource } from '../../src/features/fieldSuggestions/sources/schemaEnumSource';
import { DEFAULT_SCHEMA_TAB_STATE } from '@shared/defaults';
import type { CollectionDetails } from '@shared/ipc';
import { ejsonParse, ejsonStringify } from '../../src/utils/ejson';
import type { CollectionTab, IndexInfo, SchemaSampleEntry } from '@shared/types';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const ID_INDEX: IndexInfo = {
  name: '_id_',
  key: [{ field: '_id', direction: 1 }],
  isIdIndex: true,
  unique: false,
  sparse: false,
  hidden: false,
  version: 2,
  sizeBytes: 4096,
};

function renderStructure(state = DEFAULT_SCHEMA_TAB_STATE, onPatch = vi.fn(), onChanged = vi.fn()) {
  return {
    onPatch,
    onChanged,
    ...render(
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection="orders"
        state={state}
        onPatch={onPatch}
        onChanged={onChanged}
      />,
    ),
  };
}

describe('StructureView — indexes above schema, one pane', () => {
  it('renders both the indexes section and the schema section', async () => {
    installAtelierMock({
      index: { list: async () => [ID_INDEX] },
      meta: { sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Indexes' })).toBeTruthy();
    expect(screen.getByLabelText('Sample size')).toBeTruthy();
  });

  it('calls index.list on entry', async () => {
    const list = vi.fn(async () => [ID_INDEX]);
    installAtelierMock({
      index: { list },
      meta: { sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ connectionId: 'c1', dbName: 'shop', collection: 'orders' }),
    );
  });

  it('does not re-sample the schema when entries are already seeded', async () => {
    const sampleSchema = vi.fn(async () => ({ docs: [] }));
    installAtelierMock({
      index: { list: async () => [ID_INDEX] },
      meta: { sampleSchema },
    });

    const entries: SchemaSampleEntry[] = [{ path: 'sku', frequency: 1, types: { string: 3 } }];
    renderStructure({ ...DEFAULT_SCHEMA_TAB_STATE, entries, sampledCount: 3, ranAt: '2026-04-21T00:00:00.000Z' });

    // Let the indexes list resolve and any queued schema-sample microtask flush.
    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());
    await Promise.resolve();
    await Promise.resolve();

    expect(sampleSchema).not.toHaveBeenCalled();
    expect(screen.getByText('sku')).toBeTruthy();
  });

  it('Resample re-samples the schema, and is the only control that does', async () => {
    const sampleSchema = vi.fn(async () => ({ docs: [{ sku: 'a' }] }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { sampleSchema },
    });

    const entries: SchemaSampleEntry[] = [{ path: 'sku', frequency: 1, types: { string: 3 } }];
    renderStructure({ ...DEFAULT_SCHEMA_TAB_STATE, entries, sampledCount: 3, ranAt: '2026-04-21T00:00:00.000Z' });

    await waitFor(() => expect(screen.getByText('sku')).toBeTruthy());
    expect(sampleSchema).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Resample' }));

    await waitFor(() => expect(sampleSchema).toHaveBeenCalledTimes(1));
  });
});

const DETAILS: CollectionDetails = {
  name: 'orders',
  type: 'collection',
  capped: false,
  stats: {
    documentCount: 42,
    sizeBytes: 1536,
    indexCount: 2,
    storageSizeBytes: 4096,
    avgObjSizeBytes: 512,
    totalIndexSizeBytes: 8192,
  },
  options: {},
};

describe('StructureView — statistics section', () => {
  it('renders a Statistics region above the Indexes region', async () => {
    installAtelierMock({
      index: { list: async () => [ID_INDEX] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    const indexes = screen.getByRole('region', { name: 'Indexes' });
    expect(stats.compareDocumentPosition(indexes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('fetches the details once on entry for the open collection', async () => {
    const collectionDetails = vi.fn(async () => DETAILS);
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    await waitFor(() => expect(collectionDetails).toHaveBeenCalledTimes(1));
    expect(collectionDetails).toHaveBeenCalledWith({
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
    });
  });

  it('shows the document count, the sizes and whether the collection is capped', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('42')).toBeTruthy());
    expect(within(stats).getByText('1.5 KB')).toBeTruthy();
    expect(within(stats).getByText('4.0 KB')).toBeTruthy();
    expect(within(stats).getByText('512 B')).toBeTruthy();
    expect(within(stats).getByText('2 · 8.0 KB')).toBeTruthy();
    expect(['Documents', 'Data size', 'Storage', 'Avg document', 'Indexes'].every((l) => within(stats).queryByText(l))).toBe(true);
    // Capped is shown only for a capped collection.
    expect(within(stats).queryByText('Capped')).toBeNull();
  });

  it('adds a Capped tile for a capped collection', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => ({ ...DETAILS, capped: true }), sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    expect(await within(stats).findByText('Capped')).toBeTruthy();
    expect(within(stats).getByText('Yes')).toBeTruthy();
  });

  it('shows a dash for a size the server did not report', async () => {
    const bare = { documentCount: 42, sizeBytes: 1536, indexCount: 2 };
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({ ...DETAILS, stats: bare }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('42')).toBeTruthy());
    expect(within(stats).getAllByText('—').length).toBe(2);
    expect(within(stats).getByText('2 · —')).toBeTruthy();
  });

  it('shows a view as a view on its source with no figures', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({
          name: 'orders',
          type: 'view' as const,
          capped: false,
          options: { viewOn: 'src', pipeline: '[]' },
        }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('View on src')).toBeTruthy());
    expect(within(stats).queryByText('Documents')).toBeNull();
  });

  it('never asks a view for its indexes, not even before its details arrive', async () => {
    const list = vi.fn(async () => []);
    installAtelierMock({
      index: { list },
      meta: {
        collectionDetails: async () => ({
          name: 'orders',
          type: 'view' as const,
          capped: false,
          options: { viewOn: 'src', pipeline: '[]' },
        }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    expect(await screen.findByText(/This view uses the indexes of src/)).toBeTruthy();
    expect(list).not.toHaveBeenCalled();
  });

  it('shows a failed fetch inline while the indexes still render', async () => {
    installAtelierMock({
      index: { list: async () => [ID_INDEX] },
      meta: {
        collectionDetails: async () => {
          throw new Error('not authorized');
        },
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByRole('alert').textContent).toContain('not authorized'));
    await waitFor(() => expect(screen.getByText('_id_')).toBeTruthy());
  });

  it('shows a dash for a document or index count the server did not report', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({
          ...DETAILS,
          type: 'timeseries' as const,
          stats: { sizeBytes: 1536, storageSizeBytes: 4096 },
        }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('1.5 KB')).toBeTruthy());
    const documents = within(stats).getByText('Documents').parentElement!;
    expect(within(documents).getByText('—')).toBeTruthy();
    expect(within(stats).queryByText('0')).toBeNull();
    expect(within(within(stats).getByText('Indexes').parentElement!).getByText('—')).toBeTruthy();
  });

  it('holds every section below the statistics until the details arrive, so none is pushed down', async () => {
    let resolve!: (d: CollectionDetails) => void;
    const sampleSchema = vi.fn(async () => ({ docs: [] }));
    const list = vi.fn(async () => [ID_INDEX]);
    installAtelierMock({
      index: { list },
      meta: {
        collectionDetails: () => new Promise<CollectionDetails>((r) => (resolve = r)),
        sampleSchema,
      },
    });

    renderStructure();

    await screen.findByRole('region', { name: 'Statistics' });
    expect(screen.queryByRole('region', { name: 'Indexes' })).toBeNull();
    expect(screen.queryByLabelText('Sample size')).toBeNull();
    expect(sampleSchema).not.toHaveBeenCalled();

    await act(async () => resolve(DETAILS));
    expect(await screen.findByRole('region', { name: 'Indexes' })).toBeTruthy();
    expect(screen.getByLabelText('Sample size')).toBeTruthy();
  });

  it('reserves the space of the reported indexes while their list loads', async () => {
    installAtelierMock({
      index: { list: () => new Promise<IndexInfo[]>(() => {}) },
      meta: {
        collectionDetails: async () => ({ ...DETAILS, stats: { ...DETAILS.stats, indexCount: 3 } }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const loading = await screen.findByText('Loading indexes…');
    expect(Number.parseInt(loading.style.minHeight, 10)).toBeGreaterThan(3 * 30);
  });

  it('says Loading until the first reply arrives', async () => {
    let resolve!: (d: CollectionDetails) => void;
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: () => new Promise<CollectionDetails>((r) => (resolve = r)),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    expect(within(stats).getByText('Loading…')).toBeTruthy();
    await act(async () => resolve(DETAILS));
    await waitFor(() => expect(within(stats).getByText('42')).toBeTruthy());
    expect(within(stats).queryByText('Loading…')).toBeNull();
  });

  it('drops the previous collection\'s figures while the next one loads', async () => {
    const collectionDetails = vi.fn(({ collection }: { collection: string }) =>
      collection === 'orders'
        ? Promise.resolve(DETAILS)
        : new Promise<CollectionDetails>(() => undefined),
    );
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
    });
    const view = (collection: string) => (
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection={collection}
        state={DEFAULT_SCHEMA_TAB_STATE}
        onPatch={vi.fn()}
      />
    );

    const { rerender } = render(view('orders'));
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('42')).toBeTruthy());

    rerender(view('customers'));

    await waitFor(() => expect(within(stats).getByText('Loading…')).toBeTruthy());
    expect(within(stats).queryByText('42')).toBeNull();
  });

  it('ignores a slow reply for a collection the tab has since left', async () => {
    let resolveOrders!: (d: CollectionDetails) => void;
    const collectionDetails = vi.fn(({ collection }: { collection: string }) =>
      collection === 'orders'
        ? new Promise<CollectionDetails>((resolve) => {
            resolveOrders = resolve;
          })
        : Promise.resolve({ ...DETAILS, name: collection, stats: { ...DETAILS.stats!, documentCount: 7 } }),
    );
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
    });
    const view = (collection: string) => (
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection={collection}
        state={DEFAULT_SCHEMA_TAB_STATE}
        onPatch={vi.fn()}
      />
    );

    const { rerender } = render(view('orders'));
    await waitFor(() => expect(collectionDetails).toHaveBeenCalledTimes(1));
    rerender(view('customers'));
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('7')).toBeTruthy());

    await act(async () => {
      resolveOrders(DETAILS);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(within(stats).getByText('7')).toBeTruthy();
    expect(within(stats).queryByText('42')).toBeNull();
  });

  it('has exactly one Refresh; it reloads statistics, indexes and validation and does not sample', async () => {
    const collectionDetails = vi.fn(async () => DETAILS);
    const list = vi.fn(async () => [ID_INDEX]);
    const sampleSchema = vi.fn(async () => ({ docs: [] }));
    installAtelierMock({ index: { list }, meta: { collectionDetails, sampleSchema } });

    const entries: SchemaSampleEntry[] = [{ path: 'sku', frequency: 1, types: { string: 3 } }];
    renderStructure({ ...DEFAULT_SCHEMA_TAB_STATE, entries, sampledCount: 3, ranAt: '2026-04-21T00:00:00.000Z' });

    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(collectionDetails).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: /refresh/i })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(collectionDetails).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(sampleSchema).not.toHaveBeenCalled();
  });

  it('labels the schema button Sample before a sample and Resample after', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

    const { rerender } = renderStructure({ ...DEFAULT_SCHEMA_TAB_STATE, entries: [] });
    expect(await screen.findByRole('button', { name: 'Sample' })).toBeTruthy();
    expect(screen.getByText('Click Sample to sample documents.')).toBeTruthy();

    rerender(
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection="orders"
        state={{ ...DEFAULT_SCHEMA_TAB_STATE, entries: [], ranAt: '2026-04-21T00:00:00.000Z' }}
        onPatch={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Resample' })).toBeTruthy();
  });
});

describe('StructureView — section pills', () => {
  const sampled = {
    ...DEFAULT_SCHEMA_TAB_STATE,
    entries: [
      { path: 'sku', frequency: 1, types: { string: 3 } },
      { path: 'qty', frequency: 0.5, types: { int: 3 } },
    ] as SchemaSampleEntry[],
    sampledCount: 3,
    ranAt: '2026-04-21T00:00:00.000Z',
  };

  it('names the sections with their counts, in the order Indexes, Schema, Validation', async () => {
    installAtelierMock({
      index: { list: async () => [ID_INDEX] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure(sampled);

    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    await waitFor(() => expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Indexes 2',
      'Schema 2 fields',
      'Validation',
    ]));
    const [indexes, schema, validation] = ['Indexes', 'Schema', 'Validation'].map((n) => screen.getByRole('region', { name: n }));
    expect(indexes!.compareDocumentPosition(schema!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(schema!.compareDocumentPosition(validation!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('jumps to a section and marks its pill', async () => {
    const scrolled: Element[] = [];
    const proto = HTMLElement.prototype as { scrollIntoView?: (arg?: unknown) => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    try {
      installAtelierMock({
        index: { list: async () => [] },
        meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
      });
      renderStructure(sampled);

      const nav = await screen.findByRole('navigation', { name: 'Sections' });
      const indexesPill = await within(nav).findByRole('button', { name: /^Indexes/ });
      expect(indexesPill.getAttribute('aria-current')).toBe('true');

      await userEvent.click(within(nav).getByRole('button', { name: /^Schema/ }));

      expect(scrolled).toContain(screen.getByRole('region', { name: 'Schema' }));
      expect(within(nav).getByRole('button', { name: /^Schema/ }).getAttribute('aria-current')).toBe('true');
      expect(indexesPill.getAttribute('aria-current')).toBeNull();
    } finally {
      proto.scrollIntoView = original;
    }
  });

  it('offers no Validation pill for a view', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({ name: 'orders', type: 'view' as const, capped: false, options: { viewOn: 'src', pipeline: '[]' } }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });
    renderStructure(sampled);

    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    await within(nav).findByRole('button', { name: /^Schema/ });
    expect(within(nav).queryByRole('button', { name: 'Validation' })).toBeNull();
  });
});

describe('StructureView — schema rows', () => {
  const entries: SchemaSampleEntry[] = [
    { path: 'items', frequency: 1, types: { array: 1 } },
    { path: 'items.qty', frequency: 0.5, types: { int: 1 } },
    { path: 'sku', frequency: 0, types: { string: 1 } },
  ];
  const state = { ...DEFAULT_SCHEMA_TAB_STATE, entries, sampledCount: 2, ranAt: '2026-04-21T00:00:00.000Z' };
  const mock = (type: 'collection' | 'view' = 'collection') =>
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () =>
          type === 'view'
            ? { name: 'orders', type, capped: false, options: { viewOn: 'src', pipeline: '[]' } }
            : DETAILS,
        sampleSchema: async () => ({ docs: [] }),
      },
    });

  it('indents a nested field by depth and names it by its last segment', async () => {
    mock();
    renderStructure(state);

    const qty = await screen.findByText('qty');
    expect(qty.getAttribute('title')).toBe('items.qty');
    expect(screen.queryByText('items.qty')).toBeNull();
    const pad = (el: HTMLElement) => Number.parseInt(el.closest('td')!.style.paddingLeft, 10);
    expect(pad(qty)).toBeGreaterThan(pad(screen.getByText('items')));
  });

  it('draws the frequency as a bar at 0, 50 and 100% with the percentage beside it', async () => {
    mock();
    renderStructure(state);

    await screen.findByText('qty');
    expect(screen.getAllByTestId('frequency-bar').map((b) => b.style.width)).toEqual(['100%', '50%', '0%']);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('offers Filter by this field and Create index on this field from a row menu', async () => {
    mock();
    const onFilterField = vi.fn();
    render(
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection="orders"
        state={state}
        onPatch={vi.fn()}
        onFilterField={onFilterField}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Actions for items.qty' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Filter by this field' }));
    expect(onFilterField).toHaveBeenCalledWith('items.qty');

    await userEvent.click(screen.getByRole('button', { name: 'Actions for items.qty' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create index on this field' }));
    expect(await screen.findByDisplayValue('items.qty')).toBeTruthy();
  });

  it('offers no index creation on a view or a Read-Only Connection', async () => {
    mock('view');
    const { unmount } = render(
      <StructureView connectionId="c1" dbName="shop" collection="orders" state={state} onPatch={vi.fn()} />,
    );
    await screen.findByText('qty');
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    unmount();

    mock();
    render(
      <StructureView connectionId="c1" dbName="shop" collection="orders" state={state} onPatch={vi.fn()} readOnly />,
    );
    await screen.findByText('qty');
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });
});

describe('StructureView — validation rules', () => {
  const RULES = '{"$jsonSchema":{"required":["name"]}}';
  const withRules = (options: CollectionDetails['options']): CollectionDetails => ({ ...DETAILS, options });

  it('renders the Validation region after the indexes and the schema', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => withRules({ validator: RULES }), sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    const indexes = screen.getByRole('region', { name: 'Indexes' });
    const schema = screen.getByLabelText('Sample size');
    expect(indexes.compareDocumentPosition(schema) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(schema.compareDocumentPosition(validation) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the rules, the level and the action from the details', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () =>
          withRules({ validator: RULES, validationLevel: 'moderate', validationAction: 'warn' }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    await waitFor(() => expect(within(validation).getByText(/"required"/)).toBeTruthy());
    expect(within(validation).getByText(/"\$jsonSchema"/).textContent).toBe(
      JSON.stringify(JSON.parse(RULES), null, 2),
    );
    expect(within(validation).getByText('Level: moderate')).toBeTruthy();
    expect(within(validation).getByText('Action: warn')).toBeTruthy();
  });

  it('says there are no rules in one line, with an Add rules action, when none are set', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    expect(await within(validation).findByText('No validation rules')).toBeTruthy();
    expect(within(validation).getByRole('button', { name: 'Add rules' })).toBeTruthy();
    expect(within(validation).queryByText(/^Level:/)).toBeNull();
  });

  it('reads a cleared validator ({}) as no rules', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => withRules({ validator: '{}' }), sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    expect(await within(validation).findByText('No validation rules')).toBeTruthy();
  });

  it('Edit rules, a new level, Save: modifies the collection, keeps the editor until the new details arrive, then shows them', async () => {
    let resolveReload!: (d: CollectionDetails) => void;
    const collectionDetails = vi
      .fn<() => Promise<CollectionDetails>>()
      .mockResolvedValueOnce(withRules({ validator: RULES }))
      .mockImplementationOnce(() => new Promise<CollectionDetails>((r) => (resolveReload = r)));
    const modify = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
      collection: { modify },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    await userEvent.selectOptions(within(validation).getByLabelText('Validation level'), 'moderate');
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(modify).toHaveBeenCalledTimes(1));
    const [input] = modify.mock.calls[0] as unknown as [
      { connectionId: string; dbName: string; collection: string; options: Record<string, string> },
    ];
    expect(input).toMatchObject({
      connectionId: 'c1',
      dbName: 'shop',
      collection: 'orders',
      options: { validationLevel: 'moderate', validationAction: 'error' },
    });
    expect(JSON.parse(input.options.validator!)).toEqual(JSON.parse(RULES));

    // The save landed but the details are still being read: the old rules must not flash back.
    await waitFor(() => expect(collectionDetails).toHaveBeenCalledTimes(2));
    expect(within(validation).getByLabelText('Validator')).toBeTruthy();
    expect(within(validation).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(validation).queryByText('Level: strict')).toBeNull();

    await act(async () => resolveReload(withRules({ validator: RULES, validationLevel: 'moderate' })));
    expect(await within(validation).findByText('Level: moderate')).toBeTruthy();
    expect(within(validation).queryByLabelText('Validator')).toBeNull();
  });

  it('saving the rules drops the cached enum suggestions for the collection', async () => {
    const enumRules = (values: string[]) =>
      JSON.stringify({ $jsonSchema: { properties: { status: { enum: values } } } });
    let current = enumRules(['old']);
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => withRules({ validator: current }),
        sampleSchema: async () => ({ docs: [] }),
      },
      collection: {
        modify: async () => {
          current = enumRules(['new']);
          return { ok: true as const };
        },
      },
    });
    const target = { connectionId: 'c1', dbName: 'shop', collection: 'orders', target: { field: 'status' } };
    const displays = async () => (await schemaEnumSource(target)).map((s) => s.display);
    expect(await displays()).toEqual(['old']);

    renderStructure();
    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(validation).queryByLabelText('Validator')).toBeNull());

    expect(await displays()).toEqual(['new']);
  });

  it('shows and edits rules as readable JSON, and saving them unchanged sends the same rules', async () => {
    const canonical = '{"$jsonSchema":{"properties":{"qty":{"minimum":{"$numberInt":"0"}}}}}';
    const modify = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => withRules({ validator: canonical }), sampleSchema: async () => ({ docs: [] }) },
      collection: { modify },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    const shown = await within(validation).findByText(/"minimum"/);
    expect(shown.textContent).toContain('"minimum": 0');
    expect(shown.textContent).not.toContain('$numberInt');

    await userEvent.click(within(validation).getByRole('button', { name: /^(Add|Edit) rules$/ }));
    const editor = within(validation).getByLabelText('Validator') as HTMLTextAreaElement;
    expect(editor.value).toContain('"minimum": 0');
    expect(editor.value).not.toContain('$numberInt');
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(modify).toHaveBeenCalledTimes(1));
    const [input] = modify.mock.calls[0] as unknown as [{ options: { validator: string } }];
    expect(ejsonStringify(ejsonParse(input.options.validator))).toBe(ejsonStringify(ejsonParse(canonical)));
  });

  it('offers and shows the errorAndLog action', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => withRules({ validator: RULES, validationAction: 'errorAndLog' }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    expect(await within(validation).findByText('Action: errorAndLog')).toBeTruthy();
    await userEvent.click(within(validation).getByRole('button', { name: /^(Add|Edit) rules$/ }));
    expect((within(validation).getByLabelText('Validation action') as HTMLSelectElement).value).toBe('errorAndLog');
  });

  it('renders no Validation region for a time-series collection, which the server refuses collMod rules on', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({ ...DETAILS, type: 'timeseries' as const }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('42')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Validation' })).toBeNull();
  });

  it('renders no Validation region when the details read fails, and the statistics section shows the alert', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => {
          throw new Error('not authorized');
        },
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByRole('alert').textContent).toContain('not authorized'));
    expect(screen.queryByRole('region', { name: 'Validation' })).toBeNull();
  });

  it('saves an emptied textarea as {}, which clears the rules', async () => {
    const modify = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => withRules({ validator: RULES }), sampleSchema: async () => ({ docs: [] }) },
      collection: { modify },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    await userEvent.clear(within(validation).getByLabelText('Validator'));
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(modify).toHaveBeenCalledWith(expect.objectContaining({ options: expect.objectContaining({ validator: '{}' }) })),
    );
  });

  it.each([
    ['invalid JSON', '{"$jsonSchema":'],
    ['an array', '[1]'],
    // Parses as JSON, but revives to a Date: main refuses it, so the client must too.
    ['a bare $date sentinel', '{"$date":"2020-01-01T00:00:00Z"}'],
    ['a bare $oid sentinel', '{"$oid":"507f1f77bcf86cd799439011"}'],
  ])('refuses %s inline without a call', async (_label, text) => {
    const modify = vi.fn(async () => ({ ok: true as const }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
      collection: { modify },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    fireEvent.change(within(validation).getByLabelText('Validator'), { target: { value: text } });
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));

    expect((await within(validation).findByRole('alert')).textContent).toMatch(/JSON document/);
    expect(modify).not.toHaveBeenCalled();
  });

  it('shows the next collection in read mode when the tab moves on mid-edit', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async ({ collection }: { collection: string }) => ({
          ...DETAILS,
          name: collection,
          options: { validator: RULES },
        }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });
    const view = (collection: string) => (
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection={collection}
        state={DEFAULT_SCHEMA_TAB_STATE}
        onPatch={vi.fn()}
      />
    );

    const { rerender } = render(view('orders'));
    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    expect(within(validation).getByLabelText('Validator')).toBeTruthy();

    rerender(view('customers'));

    const next = await screen.findByRole('region', { name: 'Validation' });
    await within(next).findByRole('button', { name: /^(Add|Edit) rules$/ });
    expect(within(next).queryByLabelText('Validator')).toBeNull();
  });

  it('shows a refused save inline and stays in edit mode', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
      collection: {
        modify: async () => {
          throw { code: 'READ_ONLY', message: 'This connection is read-only.' };
        },
      },
    });

    renderStructure();

    const validation = await screen.findByRole('region', { name: 'Validation' });
    await userEvent.click(await within(validation).findByRole('button', { name: /^(Add|Edit) rules$/ }));
    await userEvent.click(within(validation).getByRole('button', { name: 'Save' }));

    expect((await within(validation).findByRole('alert')).textContent).toMatch(/read-only/);
    expect(within(validation).getByLabelText('Validator')).toBeTruthy();
  });

  it('renders no Validation region for a view', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({
          name: 'orders',
          type: 'view' as const,
          capped: false,
          options: { viewOn: 'src', pipeline: '[]' },
        }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();

    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('View on src')).toBeTruthy());
    expect(screen.queryByRole('region', { name: 'Validation' })).toBeNull();
  });
});

describe('SchemaView — distinct values and numeric range', () => {
  it('renders the Distinct and Range cells of an entry that carries them', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });
    const entries: SchemaSampleEntry[] = [
      { path: 'qty', frequency: 1, types: { number: 4 }, distinct: 2, numeric: { min: 1, max: 9, avg: 4.5 } },
      { path: 'note', frequency: 1, types: { string: 4 } },
    ];

    renderStructure({
      ...DEFAULT_SCHEMA_TAB_STATE,
      entries,
      sampledCount: 4,
      ranAt: '2026-04-21T00:00:00.000Z',
    });

    expect(await screen.findByRole('columnheader', { name: 'Distinct' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Range' })).toBeTruthy();
    const qtyRow = screen.getByText('qty').closest('tr')!;
    expect(within(qtyRow).getByText('2')).toBeTruthy();
    expect(within(qtyRow).getByText('1 – 9 · avg 4.5')).toBeTruthy();
    const noteRow = screen.getByText('note').closest('tr')!;
    expect(within(noteRow).getAllByText('—').length).toBe(2);
  });
});

describe('SchemaView — sample size is bounded by what meta:sampleSchema accepts', () => {
  it('offers exactly 50, 100 and 200', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: { sampleSchema: async () => ({ docs: [] }) },
    });
    renderStructure();

    const select = (await screen.findByLabelText('Sample size')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['50', '100', '200']);
  });

  it('samples at the bound when a restored tab carries a size the channel would refuse', async () => {
    const sampleSchema = vi.fn(async () => ({ docs: [{ sku: 'a' }] }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { sampleSchema },
    });
    const entries: SchemaSampleEntry[] = [{ path: 'sku', frequency: 1, types: { string: 3 } }];
    renderStructure({
      ...DEFAULT_SCHEMA_TAB_STATE,
      sampleSize: 500,
      entries,
      sampledCount: 3,
      ranAt: '2026-04-21T00:00:00.000Z',
    });

    await userEvent.click(await screen.findByRole('button', { name: 'Resample' }));

    await waitFor(() => expect(sampleSchema).toHaveBeenCalledTimes(1));
    expect(sampleSchema).toHaveBeenCalledWith(expect.objectContaining({ size: 200 }));
  });
});

// ─── Header count on return to Documents (PanelBody's structural claim) ────

const now = '2026-04-21T12:00:00.000Z';

function collectionTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'db',
    collection: 'coll',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: {
      activeView: 'documents',
      view: 'Tree',
      builder: {
        projection: [],
        sort: '',
        limit: '',
      },
      queryRaw: '{}',
      page: 0,
      pageSize: 50,
      activeBuilderTab: 'Builder',
    },
    ...overrides,
  };
}

describe('Structure view — header count across view switches', () => {
  // `CollectionHeader` sits on the sub-tab row and stays mounted across the
  // three views. Each read is a server-side stats aggregation, so a view
  // switch alone must not repeat it.
  it('does not re-read the header counts on a Documents ↔ Aggregation round trip', async () => {
    const docCount = 10;
    const collectionDetails = vi.fn(async () => ({
      name: 'coll',
      type: 'collection' as const,
      capped: false,
      stats: { documentCount: docCount, indexCount: 1 },
      options: {},
    }));
    installAtelierMock({
      tabs: {
        list: async () => [collectionTab()],
        update: async () => collectionTab() as never,
      },
      conn: {
        list: async () => [
          {
            id: 'c1',
            name: 'Prod',
            color: '#1A6835',
            host: 'localhost',
            port: 27017,
            connectionType: 'standard',
            readOnly: false,
            status: 'connected',
          },
        ],
      },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
      index: { list: async () => [] },
    });

    render(
      <MemoryRouter initialEntries={['/workspace']}>
        <Workspace />
      </MemoryRouter>,
    );

    // Matched by the header's own test id: Schema & indexes' statistics also print the count.
    const headerStats = (n: number) =>
      screen.getAllByTestId('collection-figures').find((el) => el.textContent?.startsWith(`${n} documents`));
    await waitFor(() => expect(headerStats(10)).toBeTruthy());

    await waitFor(() => expect(collectionDetails).toHaveBeenCalled());
    const callsBefore = collectionDetails.mock.calls.length;

    await userEvent.click(screen.getByRole('tab', { name: /Aggregation/i }));
    // An empty pipeline offers starter chips rather than an Add stage button.
    await screen.findByText('Add a first stage');
    await userEvent.click(screen.getByRole('tab', { name: /Documents/i }));
    await screen.findByTestId('query-bar-input');
    await new Promise((r) => setTimeout(r, 50));

    expect(collectionDetails.mock.calls.length).toBe(callsBefore);
    expect(headerStats(10)).toBeTruthy();
  });
});

describe('StructureView — the statistics header follows writes', () => {
  const NAMED_INDEX: IndexInfo = { ...ID_INDEX, name: 'email_1', isIdIndex: false, key: [{ field: 'email', direction: 1 }] };
  const withIndexCount = (indexCount: number): CollectionDetails => ({
    ...DETAILS,
    stats: { ...DETAILS.stats!, indexCount, totalIndexSizeBytes: 4096 * indexCount },
  });

  it('shows the new index count and size after an index is created', async () => {
    let created = false;
    installAtelierMock({
      index: {
        list: async () => (created ? [ID_INDEX, NAMED_INDEX] : [ID_INDEX]),
        create: async () => {
          created = true;
          return { name: 'email_1' };
        },
      },
      meta: {
        collectionDetails: async () => withIndexCount(created ? 3 : 2),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    const { onChanged } = renderStructure();
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('2 · 8.0 KB')).toBeTruthy());
    expect(onChanged).not.toHaveBeenCalled();

    await userEvent.click(screen.getByText('+ New index'));
    await userEvent.type(await screen.findByLabelText('Field 1'), 'email');
    await userEvent.click(screen.getByText('Create index'));

    await waitFor(() => expect(within(stats).getByText('3 · 12.0 KB')).toBeTruthy());
    // The collection header above the sub-tabs re-reads its index count on this.
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the new index count after an index is dropped', async () => {
    let dropped = false;
    installAtelierMock({
      index: {
        list: async () => (dropped ? [ID_INDEX] : [ID_INDEX, NAMED_INDEX]),
        drop: async () => {
          dropped = true;
          return { dropped: true as const };
        },
      },
      meta: {
        collectionDetails: async () => withIndexCount(dropped ? 1 : 2),
        sampleSchema: async () => ({ docs: [] }),
      },
    });

    renderStructure();
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('2 · 8.0 KB')).toBeTruthy());

    await userEvent.click(await screen.findByLabelText('Drop index email_1'));
    await userEvent.type(await screen.findByLabelText('Confirm index name'), 'email_1');
    await userEvent.click(screen.getByText('Drop').closest('button')!);

    await waitFor(() => expect(within(stats).getByText('1 · 4.0 KB')).toBeTruthy());
  });

  it('shows the new source when its view is modified from the navigator', async () => {
    let viewOn = 'src';
    const collectionDetails = vi.fn(async () => ({
      name: 'orders',
      type: 'view' as const,
      capped: false,
      options: { viewOn, pipeline: '[]' },
    }));
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    await waitFor(() => expect(within(stats).getByText('View on src')).toBeTruthy());

    viewOn = 'dst';
    act(() => notifyCollectionChanged({ connectionId: 'c1', dbName: 'shop', collection: 'orders' }));

    await waitFor(() => expect(within(stats).getByText('View on dst')).toBeTruthy());
  });

  it('ignores a change to another collection', async () => {
    const collectionDetails = vi.fn(async () => DETAILS);
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails, sampleSchema: async () => ({ docs: [] }) },
    });

    renderStructure();
    await waitFor(() => expect(collectionDetails).toHaveBeenCalledTimes(1));

    act(() => {
      notifyCollectionChanged({ connectionId: 'c1', dbName: 'shop', collection: 'customers' });
      notifyCollectionChanged({ connectionId: 'c2', dbName: 'shop', collection: 'orders' });
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(collectionDetails).toHaveBeenCalledTimes(1);
  });
});

describe('StructureView — review fixes', () => {
  const state = (entries: SchemaSampleEntry[], extra = {}) => ({
    ...DEFAULT_SCHEMA_TAB_STATE,
    entries,
    sampledCount: 2,
    ranAt: '2026-04-21T00:00:00.000Z',
    ...extra,
  });
  const base = () =>
    installAtelierMock({
      index: { list: async () => [] },
      meta: { collectionDetails: async () => DETAILS, sampleSchema: async () => ({ docs: [] }) },
    });

  it('keeps the pill bar pinned to the top of the scrolling pane', async () => {
    base();
    renderStructure(state([]));
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    const bar = nav.parentElement!;
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
  });

  it('pluralises the field count and omits it after a failed sample', async () => {
    base();
    const one: SchemaSampleEntry[] = [{ path: 'sku', frequency: 1, types: { string: 1 } }];
    const { rerender } = renderStructure(state(one));
    const nav = await screen.findByRole('navigation', { name: 'Sections' });
    expect(await within(nav).findByRole('button', { name: 'Schema 1 field' })).toBeTruthy();

    rerender(
      <StructureView connectionId="c1" dbName="shop" collection="orders" state={state([], { errorMessage: 'boom' })} onPatch={vi.fn()} />,
    );
    expect(await within(nav).findByRole('button', { name: 'Schema' })).toBeTruthy();
  });

  it('offers no Create index on _id', async () => {
    base();
    render(
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection="orders"
        state={state([{ path: '_id', frequency: 1, types: { objectid: 2 } }])}
        onPatch={vi.fn()}
        onFilterField={vi.fn()}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for _id' }));
    expect(await screen.findByRole('menuitem', { name: 'Filter by this field' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Create index on this field' })).toBeNull();
  });

  it('shows one dash on the Indexes tile when neither figure was reported', async () => {
    installAtelierMock({
      index: { list: async () => [] },
      meta: {
        collectionDetails: async () => ({ ...DETAILS, stats: { documentCount: 1 } }),
        sampleSchema: async () => ({ docs: [] }),
      },
    });
    renderStructure(state([]));
    const stats = await screen.findByRole('region', { name: 'Statistics' });
    const tile = (await within(stats).findByText('Indexes')).parentElement!;
    expect(within(tile).getByText('—')).toBeTruthy();
    expect(within(stats).queryByText('— · —')).toBeNull();
  });

  it('a row\'s Create index does not consume a pending explain-drawer request', async () => {
    base();
    const onConsumed = vi.fn();
    render(
      <StructureView
        connectionId="c1"
        dbName="shop"
        collection="orders"
        state={state([{ path: 'sku', frequency: 1, types: { string: 1 } }])}
        onPatch={vi.fn()}
        initialCreate={null}
        onInitialCreateConsumed={onConsumed}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for sku' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create index on this field' }));
    await screen.findByDisplayValue('sku');
    expect(onConsumed).not.toHaveBeenCalled();
  });

  it('Filter by this field switches to Documents, then adds the field to the filter', async () => {
    base();
    const openDocuments = vi.fn();
    const patch = vi.fn();
    render(
      <CollectionWorkspaceProvider
        state={{ ...DEFAULT_COLLECTION_TAB_STATE, activeBuilderTab: 'Raw' } as never}
        actions={emptyWorkspaceActions({ patch, openDocuments })}
        meta={emptyWorkspaceMeta()}
      >
        <StructureViewConnected
          connectionId="c1"
          dbName="shop"
          collection="orders"
          state={state([{ path: 'sku', frequency: 1, types: { string: 1 } }])}
          onPatch={vi.fn()}
        />
      </CollectionWorkspaceProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for sku' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Filter by this field' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    expect(openDocuments).toHaveBeenCalledTimes(1);
  });
});
