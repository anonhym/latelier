import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../helpers/render';
import { EditDrawer } from '../../src/pages/Workspace/EditDrawer';
import { ejsonParse } from '../../src/utils/ejson';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';

interface ReplaceCall {
  connectionId: string;
  dbName: string;
  collection: string;
  filterJson: string;
  docJson: string;
}

interface UpdateOneCall {
  connectionId: string;
  dbName: string;
  collection: string;
  filterJson: string;
  updateJson: string;
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/**
 * T0.3: `EditDrawer` gains an "Update fields ($set)" mode alongside the
 * existing full-document Replace mode, wired to `api.doc.updateOne`. The
 * load-bearing property under test is that the update mode only ever sends
 * the fields the user actually typed — never the untouched ones — which is
 * what makes it safe against concurrent edits (unlike Replace).
 */
describe('EditDrawer — Update fields ($set) mode', () => {
  it('sends a partial $set patch touching only the edited field, and closes on success', async () => {
    const replaceCalls: ReplaceCall[] = [];
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          replaceCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'multi-field', status: 'pending', qty: 5 }}
        onClose={onClose}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"status": "shipped"}' } });

    fireEvent.click(screen.getByRole('button', { name: /^Apply update$/ }));

    await waitFor(() => expect(updateCalls.length).toBe(1));
    expect(replaceCalls.length).toBe(0);

    const call = updateCalls[0]!;
    expect(ejsonParse(call.filterJson)).toEqual({ _id: 42 });
    expect(ejsonParse(call.updateJson)).toEqual({ $set: { status: 'shipped' } });

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('defaults to Replace mode: clicking Save without switching mode calls doc.replace, not updateOne', async () => {
    const replaceCalls: ReplaceCall[] = [];
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        replace: async (input) => {
          replaceCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'multi-field' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(replaceCalls.length).toBe(1));
    expect(updateCalls.length).toBe(0);
  });

  it('rejects invalid EJSON in Update mode: primary button stays disabled, no IPC call', async () => {
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{not valid' } });

    const applyButton = screen.getByRole('button', {
      name: /^Apply update$/,
    }) as HTMLButtonElement;
    expect(applyButton.disabled).toBe(true);

    fireEvent.click(applyButton);
    expect(updateCalls.length).toBe(0);
  });

  it('rejects an empty patch ({}) with no IPC call', async () => {
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{}' } });

    fireEvent.click(screen.getByRole('button', { name: /^Apply update$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/at least one field/i),
    );
    expect(updateCalls.length).toBe(0);
  });

  it('rejects a patch that includes _id with no IPC call', async () => {
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"_id": 99, "sku": "y"}' } });

    fireEvent.click(screen.getByRole('button', { name: /^Apply update$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/_id/i),
    );
    expect(updateCalls.length).toBe(0);
  });

  it('rejects a non-object patch top level with no IPC call', async () => {
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '42' } });

    fireEvent.click(screen.getByRole('button', { name: /^Apply update$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/JSON object/i),
    );
    expect(updateCalls.length).toBe(0);
  });

  it('refuses to update a document with no _id, same guard as Replace', async () => {
    const updateCalls: UpdateOneCall[] = [];
    installAtelierMock({
      doc: {
        updateOne: async (input) => {
          updateCalls.push(input);
          return { matchedCount: 1, modifiedCount: 1 };
        },
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"status": "shipped"}' } });

    fireEvent.click(screen.getByRole('button', { name: /^Apply update$/ }));

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/without an _id/i),
    );
    expect(updateCalls.length).toBe(0);
  });

  it('renders exactly one textarea at all times (guards against a two-textarea regression)', async () => {
    installAtelierMock({});

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, sku: 'x' }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );

    // Replace mode (default)
    expect(screen.getByRole('textbox')).toBeTruthy();

    // Switch to Update mode
    fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));
    expect(screen.getByRole('textbox')).toBeTruthy();

    // Switch back to Replace mode
    fireEvent.click(screen.getByRole('button', { name: /Replace document/i }));
    expect(screen.getByRole('textbox')).toBeTruthy();
  });
});

/**
 * W17 — the field-type warning. A note, never a gate: it tells the user the
 * value disagrees with the field's sampled shape and lets them save anyway.
 */
describe('EditDrawer — W17 field-type warning', () => {
  /** Two sampled docs: `ref` is always an ObjectId, `qty` always a number. */
  const SAMPLE = [
    { _id: { $oid: '507f1f77bcf86cd799439011' }, ref: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, qty: 1 },
    { _id: { $oid: '507f1f77bcf86cd799439012' }, ref: { $oid: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, qty: 2 },
    { _id: { $oid: '507f1f77bcf86cd799439013' }, ref: { $oid: 'cccccccccccccccccccccccc' }, qty: 3 },
  ];

  /** `mixed` splits 2/1 — below the 90% cutoff, so nothing about it warns. */
  const MIXED_SAMPLE = [{ mixed: 'a' }, { mixed: 'b' }, { mixed: 1 }];

  async function renderDrawer(docs: unknown[], mode: 'update' | 'replace' = 'update') {
    // The cache is module-level and survives between tests in this file.
    const { invalidateSampleSchemaCache } = await import(
      '../../src/features/fieldSuggestions/sources/sampleSchemaSource'
    );
    invalidateSampleSchemaCache();
    installAtelierMock({
      meta: { sampleSchema: async () => ({ docs }) } as never,
      doc: {
        updateOne: async () => ({ matchedCount: 1, modifiedCount: 1 }),
        replace: async () => ({ matchedCount: 1, modifiedCount: 1 }),
      },
    });

    render(
      <EditDrawer
        connectionId="c1"
        dbName="db"
        collection="coll"
        doc={{ _id: 42, ref: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, qty: 1 }}
        onClose={() => undefined}
        onSaved={() => undefined}
      />,
    );
    if (mode === 'update') {
      fireEvent.click(screen.getByRole('button', { name: /Update fields/i }));
    }
    return screen.getByRole('textbox') as HTMLTextAreaElement;
  }

  const warnings = () => screen.queryAllByTestId('edit-drawer-type-warning');

  it('warns when a $set value disagrees with the field dominant sampled type', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"qty": "seven"}' } });

    await waitFor(() => expect(warnings().length).toBe(1));
    expect(warnings()[0]!.textContent).toBe(
      'Field "qty" is usually number (100% of sampled documents). This value is string.',
    );
  });

  it('never disables Save — the warning is a note, not a gate', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"qty": "seven"}' } });

    await waitFor(() => expect(warnings().length).toBe(1));
    const apply = screen.getByRole('button', { name: /^Apply update$/ }) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    // Muted, not the `T.warn` stop-sign styling `refusal`/`err` use, and not
    // an alert — a screen reader should not be interrupted by it.
    expect(warnings()[0]!.getAttribute('role')).toBeNull();
  });

  it('does not warn on a correct sentinel-shaped BSON value', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, {
      target: { value: '{"ref": {"$oid": "dddddddddddddddddddddddd"}}' },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('reads a sentinel value as its BSON type, not as a sub-document', async () => {
    // The regression guard for the parse rule (W17 §3). `ejsonParse` revives
    // {"$oid": …} into an ObjectId *instance*, which has no `$oid` key, so
    // `inferType` reads it as `object` — and the sub-document skip then
    // swallows it silently. Every BSON-typed value would stop being checked
    // at all. Only `JSON.parse` keeps the sentinel legible.
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, {
      target: { value: '{"qty": {"$oid": "dddddddddddddddddddddddd"}}' },
    });

    await waitFor(() => expect(warnings().length).toBe(1));
    expect(warnings()[0]!.textContent).toBe(
      'Field "qty" is usually number (100% of sampled documents). This value is objectid.',
    );
  });

  it('treats a sentinel key mixed with other keys as a sub-document', async () => {
    // `{"$oid": …, "extra": true}` fails bson's exact-wrapper test, so
    // ejsonParse leaves it a plain object and updateOne stores a
    // sub-document. Reading `$oid in v` alone would call it `objectid` and
    // warn "This value is objectid" about a value that is not one.
    // Sub-documents are out of scope (W17 §8), so the right answer is
    // silence — not a differently-worded warning.
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, {
      target: { value: '{"qty": {"$oid": "507f1f77bcf86cd799439011", "extra": true}}' },
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('does not warn when the value agrees, or the field was never sampled', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"qty": 9, "brandNew": "x"}' } });

    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('does not warn on a field whose sampled types are already mixed', async () => {
    const textarea = await renderDrawer(MIXED_SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"mixed": true}' } });

    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('shows nothing while the buffer is unparseable', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"qty": "seven"}' } });
    await waitFor(() => expect(warnings().length).toBe(1));

    fireEvent.change(textarea, { target: { value: '{"qty": "seven"' } });
    await waitFor(() => expect(warnings().length).toBe(0));
  });

  it('never warns in Replace mode, whatever the buffer holds', async () => {
    const textarea = await renderDrawer(SAMPLE, 'replace');
    fireEvent.change(textarea, { target: { value: '{"_id": 42, "qty": "seven"}' } });

    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('does not check a nested or dotted key', async () => {
    const textarea = await renderDrawer([
      { addr: 'one-line string', qty: 1 },
      { addr: 'another string', qty: 2 },
      { addr: 'a third string', qty: 3 },
    ]);
    // `addr` is sampled as string at 100%; both of these disagree, and both
    // are out of scope this version.
    fireEvent.change(textarea, { target: { value: '{"addr.city": "NYC"}' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);

    fireEvent.change(textarea, { target: { value: '{"addr": {"city": "NYC"}}' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(warnings().length).toBe(0);
  });

  it('shows one line per disagreeing field, in the patch key order', async () => {
    const textarea = await renderDrawer(SAMPLE);
    fireEvent.change(textarea, { target: { value: '{"qty": "seven", "ref": 3}' } });

    await waitFor(() => expect(warnings().length).toBe(2));
    expect(warnings().map((n) => n.textContent)).toEqual([
      'Field "qty" is usually number (100% of sampled documents). This value is string.',
      'Field "ref" is usually objectid (100% of sampled documents). This value is number.',
    ]);
  });
});
