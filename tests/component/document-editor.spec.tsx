import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '../helpers/render';
import { DocumentEditor } from '../../src/pages/Workspace/DocumentEditor';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources/sampleSchemaSource';
import type { IpcApi } from '@shared/ipc';

afterEach(() => {
  uninstallAtelierMock();
  invalidateSampleSchemaCache();
  vi.restoreAllMocks();
});

const OID = '507f1f77bcf86cd799439011';

/** A result row as `find` delivers it: canonical sentinels, never live BSON. */
const DOC = {
  _id: { $oid: OID },
  name: 'widget',
  qty: { $numberInt: '5' },
  big: { $numberLong: '9007199254740993' },
  price: { $numberDouble: '1.5' },
  cost: { $numberDecimal: '1.10' },
  active: true,
  at: { $date: { $numberLong: '0' } },
  ref: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' },
  gone: null,
  tags: ['a'],
  nested: { city: 'A' },
};

type UpdateInput = Parameters<IpcApi['doc']['updateOne']>[0];

function setup({
  doc = DOC as unknown,
  updateOne = vi.fn<IpcApi['doc']['updateOne']>(async () => ({ matchedCount: 1, modifiedCount: 1 })),
  findOne,
  prefs,
  sample,
}: {
  doc?: unknown;
  updateOne?: ReturnType<typeof vi.fn<IpcApi['doc']['updateOne']>>;
  findOne?: IpcApi['query']['findOne'];
  prefs?: Partial<IpcApi['prefs']>;
  sample?: unknown[];
} = {}) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  installAtelierMock({
    doc: { updateOne },
    ...(findOne ? { query: { findOne } } : {}),
    ...(prefs ? { prefs } : {}),
    ...(sample ? { meta: { sampleSchema: async () => ({ docs: sample }) } as never } : {}),
  });
  render(
    <DocumentEditor
      connectionId="c1"
      dbName="shop"
      collection="orders"
      doc={doc}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved, updateOne };
}

const editor = () => screen.getByRole('dialog', { name: 'Edit document' });
const field = (name: string) => within(editor()).getByRole('textbox', { name }) as HTMLInputElement;
const row = (name: string) => editor().querySelector(`[data-field="${name}"]`) as HTMLElement;
const save = () => within(editor()).getByRole('button', { name: 'Save' });
const lastCall = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls.at(-1)![0] as UpdateInput;
const typeSelect = (name: string) => within(row(name)).getByRole('combobox', { name: `${name} type` }) as HTMLSelectElement;
const addFieldBox = (parent = 'root') => within(editor()).getByTestId(`add-field-${parent}`);

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('DocumentEditor — the surface', () => {
  it('is a dialog named "Edit document" with the namespace beneath the title', () => {
    setup();
    expect(within(editor()).getByText('shop.orders')).toBeTruthy();
  });

  it('opens at the size remembered in prefs', async () => {
    setup({ prefs: { get: (async (key: string) => (key === 'ui.workspace.documentEditorSize' ? { width: 900, height: 500 } : null)) as IpcApi['prefs']['get'] } });
    const surface = screen.getByTestId('document-editor-surface');
    await waitFor(() => expect(surface.style.width).toBe('900px'));
    expect(surface.style.height).toBe('500px');
  });

  it('remembers a size the user drags to, and ignores the one it rendered', async () => {
    let fire!: () => void;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          fire = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const set = vi.fn(async (_k: string, v: unknown) => v);
    setup({
      prefs: {
        get: (async () => ({ width: 900, height: 500 })) as IpcApi['prefs']['get'],
        set: set as unknown as IpcApi['prefs']['set'],
      },
    });
    const surface = screen.getByTestId('document-editor-surface');
    await waitFor(() => expect(surface.style.width).toBe('900px'));

    fire();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(set).not.toHaveBeenCalled();

    surface.style.width = '800px';
    surface.style.height = '420px';
    fire();
    await waitFor(() => expect(set).toHaveBeenCalledWith('ui.workspace.documentEditorSize', { width: 800, height: 420 }));
    vi.unstubAllGlobals();
  });
});

describe('DocumentEditor — Fields view', () => {
  it('gives each scalar its own input, and renders the rest read-only', () => {
    setup();
    expect(field('name').value).toBe('widget');
    expect(field('qty').value).toBe('5');
    expect(field('big').value).toBe('9007199254740993');
    expect(field('price').value).toBe('1.5');
    expect(field('cost').value).toBe('1.10');
    expect(field('at').value).toBe('1970-01-01T00:00:00Z');
    expect(field('ref').value).toBe('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect((within(editor()).getByRole('switch', { name: 'active' }) as HTMLInputElement).checked).toBe(true);
    // `_id` is always locked; `nested` is a container — it has no textbox of
    // its own, its children (tested separately) do.
    for (const readOnly of ['_id', 'nested']) {
      expect(within(editor()).queryByRole('textbox', { name: readOnly })).toBeNull();
    }
    expect(within(row('gone')).getByText('null')).toBeTruthy();
    expect(field('tags').value).toBe('["a"]');
    expect((row('qty').querySelector('select') as HTMLSelectElement).value).toBe('int32');
    expect((row('big').querySelector('select') as HTMLSelectElement).value).toBe('long');
  });

  it('shows the local time beneath a date', () => {
    setup();
    expect(within(row('at')).getByText(`Local: ${new Date(0).toLocaleString()}`)).toBeTruthy();
  });

  it('never offers an input for a field name no update path can address', () => {
    setup({ doc: { _id: 1, 'a.b': 'x', $k: 'y' } });
    expect(within(editor()).queryByRole('textbox', { name: 'a.b' })).toBeNull();
    expect(within(editor()).queryByRole('textbox', { name: '$k' })).toBeNull();
  });

  it('marks a row edited from the diff, and clears the mark when the value goes back', () => {
    setup();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    expect(row('name').dataset.edited).toBe('true');
    expect(row('qty').dataset.edited).toBeUndefined();
    fireEvent.change(field('name'), { target: { value: 'widget' } });
    expect(row('name').dataset.edited).toBeUndefined();
  });

  it('keeps a numeric type when the text looks like another one', () => {
    setup();
    fireEvent.change(field('price'), { target: { value: '2' } });
    expect(row('price').dataset.edited).toBe('true');
    expect(within(row('price')).getByText('Double')).toBeTruthy();
  });

  it('holds text that does not parse, blocks Save, and counts as unsaved', async () => {
    const { updateOne } = setup();
    fireEvent.change(field('qty'), { target: { value: '1.5' } });
    expect(within(row('qty')).getByText(/whole number/)).toBeTruthy();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(editor(), { key: 'Enter', metaKey: true });
    await settle();
    expect(updateOne).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeTruthy();
  });

  it.each([
    ['qty', '99999999999', /whole number/],
    ['big', '9223372036854775808', /64 bits/],
    ['price', 'abc', /Enter a number/],
    ['cost', 'abc', /not a valid Decimal128/],
    ['at', '2026-01-01T00:00:00', /zone/],
    ['ref', 'xyz', /24 hexadecimal/],
  ])('refuses %s = %s', (name, text, message) => {
    setup();
    fireEvent.change(field(name), { target: { value: text } });
    expect(within(row(name)).getByText(message)).toBeTruthy();
  });

  it('shows the W17 warning on a disagreeing row, and it never blocks Save', async () => {
    const sample = [1, 2, 3].map((i) => ({ _id: i, name: { $numberInt: String(i) } }));
    setup({ sample });
    expect(await within(row('name')).findByTestId('document-editor-type-warning')).toBeTruthy();
    expect(within(row('qty')).queryByTestId('document-editor-type-warning')).toBeNull();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('DocumentEditor — saving', () => {
  it('saves each scalar with its type preserved, guarded by what it loaded', async () => {
    const { updateOne, onSaved } = setup();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.change(field('qty'), { target: { value: '6' } });
    fireEvent.change(field('big'), { target: { value: '9007199254740995' } });
    fireEvent.change(field('price'), { target: { value: '2' } });
    fireEvent.change(field('cost'), { target: { value: '2.20' } });
    fireEvent.change(field('at'), { target: { value: '2026-09-24T20:31:00Z' } });
    fireEvent.change(field('ref'), { target: { value: 'bbbbbbbbbbbbbbbbbbbbbbbb' } });
    fireEvent.click(within(editor()).getByRole('switch', { name: 'active' }));
    fireEvent.click(save());

    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    const call = lastCall(updateOne);
    expect(call).toMatchObject({ connectionId: 'c1', dbName: 'shop', collection: 'orders' });
    expect(JSON.parse(call.updateJson)).toEqual({
      $set: {
        name: 'gadget',
        qty: { $numberInt: '6' },
        big: { $numberLong: '9007199254740995' },
        price: { $numberDouble: '2.0' },
        cost: { $numberDecimal: '2.20' },
        active: false,
        at: { $date: { $numberLong: String(Date.parse('2026-09-24T20:31:00Z')) } },
        ref: { $oid: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
      },
    });
    const filter = JSON.parse(call.filterJson) as Record<string, unknown>;
    expect(filter._id).toEqual({ $oid: OID });
    expect(filter.big).toEqual({ $eq: { $numberLong: '9007199254740993' } });
    expect(filter.name).toEqual({ $eq: 'widget' });
    expect(Object.keys(filter)).toHaveLength(9);
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it('passes the Reversible entry id of the update to onSaved', async () => {
    const updateOne = vi.fn<IpcApi['doc']['updateOne']>(async () => ({
      matchedCount: 1,
      modifiedCount: 1,
      auditId: 'a2',
    }));
    const { onSaved } = setup({ updateOne });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('a2'));
  });

  it('sends nothing for an unchanged document and just closes', async () => {
    const { updateOne, onClose } = setup();
    fireEvent.click(save());
    await settle();
    expect(updateOne).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves on ⌘↵ and on Ctrl+↵, never on ⌘S', async () => {
    const { updateOne } = setup();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.keyDown(field('name'), { key: 's', metaKey: true });
    await settle();
    expect(updateOne).not.toHaveBeenCalled();
    fireEvent.keyDown(field('name'), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
  });

  it('makes one request for a double click while the first is in flight', async () => {
    let resolve!: (v: { matchedCount: number; modifiedCount: number }) => void;
    const updateOne = vi.fn(() => new Promise<{ matchedCount: number; modifiedCount: number }>((r) => (resolve = r)));
    setup({ updateOne });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(updateOne).toHaveBeenCalledTimes(1);
    await act(async () => resolve({ matchedCount: 1, modifiedCount: 1 }));
  });

  it('shows an IPC error inline and keeps the draft', async () => {
    const updateOne = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'MONGO_ERROR' });
    });
    const { onSaved } = setup({ updateOne });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());
    expect(await within(editor()).findByText(/boom/)).toBeTruthy();
    expect(field('name').value).toBe('gadget');
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe('DocumentEditor — conflicts', () => {
  const conflicted = () => vi.fn<IpcApi['doc']['updateOne']>(async () => ({ matchedCount: 0, modifiedCount: 0 }));

  it('keeps the editor open with the draft intact when nothing matched', async () => {
    const { onSaved } = setup({ updateOne: conflicted() });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());
    expect(await within(editor()).findByText(/changed since you opened it/)).toBeTruthy();
    expect(field('name').value).toBe('gadget');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('Overwrite resends the same update with only _id as the filter', async () => {
    const updateOne = conflicted();
    setup({ updateOne });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());
    fireEvent.click(await within(editor()).findByRole('button', { name: 'Overwrite' }));
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(2));
    const [first, second] = updateOne.mock.calls.map((c) => c[0]);
    expect(second!.updateJson).toBe(first!.updateJson);
    expect(JSON.parse(second!.filterJson)).toEqual({ _id: { $oid: OID } });
  });

  it('Reload puts the edits on top of the fresh copy, and the next save guards the fresh values', async () => {
    const updateOne = conflicted();
    const findOne = vi.fn<IpcApi['query']['findOne']>(async () => ({
      document: { ...DOC, name: 'server-name', qty: { $numberInt: '7' } },
      durationMs: 0,
    }));
    setup({ updateOne, findOne });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());
    fireEvent.click(await within(editor()).findByRole('button', { name: 'Reload' }));

    await waitFor(() => expect(field('qty').value).toBe('7'));
    expect(JSON.parse(findOne.mock.calls[0]![0].filter)).toEqual({ _id: { $oid: OID } });
    expect(field('name').value).toBe('gadget');
    expect(row('name').dataset.edited).toBe('true');
    expect(row('qty').dataset.edited).toBeUndefined();
    expect(within(editor()).queryByText(/changed since you opened it/)).toBeNull();

    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(2));
    expect(JSON.parse(lastCall(updateOne).filterJson)).toEqual({ _id: { $oid: OID }, name: { $eq: 'server-name' } });
  });

  it('says the document was deleted when Reload finds nothing, and offers only Cancel', async () => {
    setup({ updateOne: conflicted(), findOne: async () => ({ document: null, durationMs: 0 }) });
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(save());
    fireEvent.click(await within(editor()).findByRole('button', { name: 'Reload' }));
    expect(await within(editor()).findByText(/was deleted/)).toBeTruthy();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect(within(editor()).queryByRole('button', { name: 'Reload' })).toBeNull();
  });
});

describe('DocumentEditor — dismissal', () => {
  it('Escape closes a clean editor without prompting', async () => {
    const { onClose } = setup();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  });

  it('Escape on a dirty draft prompts, and Cancel there keeps the edit', async () => {
    const { onClose } = setup();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    const prompt = await screen.findByRole('dialog', { name: 'Discard changes?' });
    fireEvent.click(within(prompt).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect(field('name').value).toBe('gadget');
  });

  it('a backdrop click on a dirty draft is inert: no close, no prompt', async () => {
    const { onClose } = setup();
    fireEvent.change(field('name'), { target: { value: 'gadget' } });
    fireEvent.click(document.body.querySelector('.mantine-Modal-overlay') as HTMLElement);
    await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
    expect(field('name').value).toBe('gadget');
  });
});

describe('DocumentEditor — nested objects', () => {
  it('edits a nested field in place, marking the field and its container edited', () => {
    setup();
    expect(field('nested.city').value).toBe('A');
    fireEvent.change(field('nested.city'), { target: { value: 'B' } });
    expect(row('nested.city').dataset.edited).toBe('true');
    expect(row('nested').dataset.edited).toBe('true');
    expect(row('name').dataset.edited).toBeUndefined();
  });

  it('saves a nested change as its dotted path, guarded by the value it loaded', async () => {
    const { updateOne } = setup();
    fireEvent.change(field('nested.city'), { target: { value: 'B' } });
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    const call = lastCall(updateOne);
    expect(JSON.parse(call.updateJson)).toEqual({ $set: { 'nested.city': 'B' } });
    expect((JSON.parse(call.filterJson) as Record<string, unknown>)['nested.city']).toEqual({ $eq: 'A' });
  });

  it('resends the whole container when an unsafe-named nested field changes', async () => {
    const { updateOne } = setup({
      doc: { ...DOC, nested: { 'a.b': { $numberInt: '1' }, city: 'A' } },
    });
    fireEvent.change(field('nested.a.b'), { target: { value: '2' } });
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    expect(JSON.parse(lastCall(updateOne).updateJson)).toEqual({
      $set: { nested: { 'a.b': { $numberInt: '2' }, city: 'A' } },
    });
  });

  it('starts expanded; Collapse hides its rows without discarding their edits', () => {
    setup();
    fireEvent.change(field('nested.city'), { target: { value: 'B' } });
    fireEvent.click(within(row('nested')).getByRole('button', { name: 'Collapse nested' }));
    expect(row('nested.city')).toBeNull();
    fireEvent.click(within(row('nested')).getByRole('button', { name: 'Expand nested' }));
    expect(field('nested.city').value).toBe('B');
  });
});

describe('DocumentEditor — arrays', () => {
  it('shows the whole array as JSON text', () => {
    setup();
    expect(field('tags').value).toBe('["a"]');
  });

  it('saves an array change as the whole array, never by index', async () => {
    const { updateOne } = setup();
    fireEvent.change(field('tags'), { target: { value: '["a","b"]' } });
    expect(row('tags').dataset.edited).toBe('true');
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    expect(JSON.parse(lastCall(updateOne).updateJson)).toEqual({ $set: { tags: ['a', 'b'] } });
  });

  it('blocks Save on invalid array JSON, and un-blocks once it parses again', () => {
    setup();
    fireEvent.change(field('tags'), { target: { value: '[' } });
    expect(within(row('tags')).getByText(/JSON array/)).toBeTruthy();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(field('tags'), { target: { value: '["a"]' } });
    expect(within(row('tags')).queryByText(/JSON array/)).toBeNull();
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('DocumentEditor — type selector', () => {
  it('is the only way a type changes, converting losslessly when it can', async () => {
    const { updateOne } = setup();
    fireEvent.change(typeSelect('qty'), { target: { value: 'double' } });
    expect(row('qty').dataset.edited).toBe('true');
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    expect(JSON.parse(lastCall(updateOne).updateJson)).toEqual({ $set: { qty: { $numberDouble: '5.0' } } });
  });

  it('clears to the target zero value when the conversion is not lossless', () => {
    setup();
    fireEvent.change(typeSelect('name'), { target: { value: 'int32' } });
    expect(field('name').value).toBe('0');
  });

  it('converting to Null drops the value input; converting away opens at the zero value', () => {
    setup();
    fireEvent.change(typeSelect('name'), { target: { value: 'null' } });
    expect(within(editor()).queryByRole('textbox', { name: 'name' })).toBeNull();
    expect(within(row('name')).getByText('null')).toBeTruthy();
    fireEvent.change(typeSelect('name'), { target: { value: 'string' } });
    expect(field('name').value).toBe('');
  });

  it('discards a pending parse error for text the new type no longer applies to', () => {
    setup();
    fireEvent.change(field('qty'), { target: { value: '1.5' } });
    expect(within(row('qty')).getByText(/whole number/)).toBeTruthy();
    fireEvent.change(typeSelect('qty'), { target: { value: 'double' } });
    expect(within(row('qty')).queryByText(/whole number/)).toBeNull();
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('DocumentEditor — add field', () => {
  it('adds a field as a draft-only String row', () => {
    setup();
    fireEvent.change(within(addFieldBox()).getByRole('textbox'), { target: { value: 'sku' } });
    fireEvent.click(within(addFieldBox()).getByRole('button', { name: 'Add field' }));
    expect(field('sku').value).toBe('');
    expect(row('sku').dataset.edited).toBe('true');
  });

  it('refuses a duplicate name inline, leaving the draft untouched', () => {
    setup();
    fireEvent.change(within(addFieldBox()).getByRole('textbox'), { target: { value: 'name' } });
    fireEvent.click(within(addFieldBox()).getByRole('button', { name: 'Add field' }));
    expect(within(addFieldBox()).getByText(/already exists/)).toBeTruthy();
    expect(row('name').dataset.edited).toBeUndefined();
  });

  it('refuses a name an update path could not address', () => {
    setup();
    fireEvent.change(within(addFieldBox()).getByRole('textbox'), { target: { value: 'a.b' } });
    fireEvent.click(within(addFieldBox()).getByRole('button', { name: 'Add field' }));
    expect(within(addFieldBox()).getByText(/cannot be saved/)).toBeTruthy();
    expect(row('a.b')).toBeNull();
  });

  it('sends the new field on save, guarded by its absence', async () => {
    const { updateOne } = setup();
    fireEvent.change(within(addFieldBox()).getByRole('textbox'), { target: { value: 'sku' } });
    fireEvent.click(within(addFieldBox()).getByRole('button', { name: 'Add field' }));
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    const call = lastCall(updateOne);
    expect(JSON.parse(call.updateJson)).toEqual({ $set: { sku: '' } });
    expect((JSON.parse(call.filterJson) as Record<string, unknown>).sku).toEqual({ $exists: false });
  });

  it('Escape with the suggestion popup open closes only the popup', async () => {
    const { onClose } = setup({ sample: [{ _id: 1, sku: 'x' }] });
    const input = within(addFieldBox()).getByRole('textbox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 's' } });
    expect(await screen.findByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Discard changes?' })).toBeNull();
  });
});

describe('DocumentEditor — remove field', () => {
  it('removes a field from the draft without confirmation', () => {
    setup();
    fireEvent.click(within(row('name')).getByRole('button', { name: 'Remove name' }));
    expect(row('name')).toBeNull();
  });

  it('sends the removal as $unset, guarded by the value it loaded', async () => {
    const { updateOne } = setup();
    fireEvent.click(within(row('name')).getByRole('button', { name: 'Remove name' }));
    fireEvent.click(save());
    await waitFor(() => expect(updateOne).toHaveBeenCalledTimes(1));
    const call = lastCall(updateOne);
    expect(JSON.parse(call.updateJson)).toEqual({ $unset: { name: '' } });
    expect((JSON.parse(call.filterJson) as Record<string, unknown>).name).toEqual({ $eq: 'widget' });
  });

  it('never offers Remove on _id', () => {
    setup();
    expect(within(row('_id')).queryByRole('button', { name: 'Remove _id' })).toBeNull();
  });
});
