// A condition changing kind: the field names a typed sample, the type chip is
// picked, or the operator moves between one value and a list. Mounted through
// the real drawer, so every patch round-trips through the tree's own history
// and Undo is the tree's undo, not a copy.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { pickValueType } from '../helpers/condRow';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources/sampleSchemaSource';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-11-18T12:00:00.000Z';

function makeState(queryRaw: string): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw,
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
  };
}

function makeTab(state: CollectionTabState): WorkspaceTab {
  return {
    id: 't1',
    kind: 'collection',
    connectionId: 'c1',
    dbName: 'mydb',
    collection: 'users',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state,
  };
}

const CONNECTION = {
  id: 'c1',
  name: 'Local',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard' as const,
  readOnly: false,
  status: 'connected' as const,
};

function lastQuery(updateSpy: ReturnType<typeof vi.fn>): string | undefined {
  for (let i = updateSpy.mock.calls.length - 1; i >= 0; i--) {
    const patch = (updateSpy.mock.calls[i]?.[1] as { state?: Partial<CollectionTabState> } | undefined)?.state;
    if (patch && 'queryRaw' in patch) return patch.queryRaw;
  }
  return undefined;
}

async function mount(queryRaw: string, docs: Record<string, unknown>[]) {
  const state = makeState(queryRaw);
  const updateSpy = vi.fn(async () => makeTab(state));
  installAtelierMock({
    tabs: {
      list: async () => [makeTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
    meta: { sampleSchema: vi.fn(async () => ({ docs })) as unknown as IpcApi['meta']['sampleSchema'] },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return updateSpy;
}

/**
 * Waits until the sample has been read and the row has re-rendered with it. The
 * "Sample:" line used to be the signal, but under an empty box the "Value is
 * empty" problem takes the one helper line.
 */
async function sampleRead() {
  await waitFor(() => expect(window.atelier!.meta.sampleSchema).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const fieldBox = () => screen.getByPlaceholderText('field') as HTMLInputElement;
const valueBox = () => screen.getByPlaceholderText('value') as HTMLTextAreaElement;
const typeChip = () => document.querySelector<HTMLButtonElement>('button[aria-label^="Value type: "]')!;

/** Types `name` into the row's field box and leaves it, once the sample has said what it holds. */
async function retypeField(name: string) {
  const box = await waitFor(() => fieldBox());
  fireEvent.focus(box);
  fireEvent.change(box, { target: { value: name } });
  await sampleRead();
  fireEvent.blur(box);
}

/** The helper line under the value box that carries an action; other status regions (the "not applied" banner) are not it. */
const helperNotice = () =>
  screen.queryAllByRole('status').find((el) => / · (Undo|Use \w+)$/.test(el.textContent ?? '')) ?? null;

const NUMBERS = Array(10).fill({ qty: 3 });

beforeEach(() => invalidateSampleSchemaCache());
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('a field change on a row', () => {
  it('an empty box adopts the sampled type and the chip flashes', async () => {
    await mount('{}', NUMBERS);
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    expect(typeChip().className).not.toContain('type-chip-flash');

    await retypeField('qty');

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(typeChip().className).toContain('type-chip-flash');
    expect(helperNotice()).toBeNull();
  });

  it('a readable value converts, says so, and Undo restores the tree before it', async () => {
    const updateSpy = await mount('{"zzz":{"$eq":"12"}}', NUMBERS);
    await screen.findByDisplayValue('zzz');
    expect(typeChip().textContent).toBe('string');

    await retypeField('qty');

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(valueBox().value).toBe('12');
    expect(helperNotice()?.textContent).toBe('Changed to number to match qty · Undo');
    expect(typeChip().className).toContain('type-chip-flash');
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"qty":{"$eq":12}}'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(typeChip().textContent).toBe('string'));
    expect(valueBox().value).toBe('12');
    expect(fieldBox().value).toBe('qty');
    expect(helperNotice()).toBeNull();
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"qty":{"$eq":"12"}}'));
  });

  it('the notice clears on the next edit', async () => {
    await mount('{"zzz":{"$eq":"12"}}', NUMBERS);
    await screen.findByDisplayValue('zzz');
    await retypeField('qty');
    await waitFor(() => expect(helperNotice()).not.toBeNull());

    fireEvent.change(valueBox(), { target: { value: '13' } });

    await waitFor(() => expect(helperNotice()).toBeNull());
  });

  it('a value that does not read as the type stays, with the hint and a way to use the type', async () => {
    await mount('{"zzz":{"$eq":"abc"}}', NUMBERS);
    await screen.findByDisplayValue('zzz');

    await retypeField('qty');

    await waitFor(() => expect(helperNotice()).not.toBeNull());
    expect(helperNotice()?.textContent).toBe('qty is a number in every sampled document · Use number');
    expect(typeChip().textContent).toBe('string');
    expect(valueBox().value).toBe('abc');
    // The hint replaces the sample line rather than sitting beside it.
    expect(screen.queryByText(/^Sample: /)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Use number' }));

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(valueBox().value).toBe('abc');
    expect(await screen.findByText('Value must be a valid number')).toBeTruthy();
    expect(helperNotice()).toBeNull();
  });

  it('says most, not every, when part of the sample disagrees', async () => {
    await mount('{"zzz":{"$eq":"abc"}}', [...Array(9).fill({ qty: 3 }), { qty: 'x' }]);
    await screen.findByDisplayValue('zzz');

    await retypeField('qty');

    await waitFor(() => expect(helperNotice()).not.toBeNull());
    expect(helperNotice()?.textContent).toBe('qty is a number in most sampled documents · Use number');
  });

  it('picking the field from the list converts too, and Undo leaves the picked field in place', async () => {
    await mount('{"zzz":{"$eq":"12"}}', NUMBERS);
    await screen.findByDisplayValue('zzz');
    const box = fieldBox();
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'qt' } });
    fireEvent.click(await screen.findByRole('option', { name: /qty/ }));

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(helperNotice()?.textContent).toBe('Changed to number to match qty · Undo');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(typeChip().textContent).toBe('string'));
    expect(fieldBox().value).toBe('qty');
  });

  it('Use on a readable value is not offered: it was already converted', async () => {
    await mount('{"zzz":{"$eq":"12"}}', NUMBERS);
    await screen.findByDisplayValue('zzz');
    await retypeField('qty');
    await waitFor(() => expect(helperNotice()).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Use number' })).toBeNull();
  });
});

describe('a type chip change', () => {
  it('carries a value that reads as the new type over', async () => {
    const updateSpy = await mount('{"f":{"$eq":"12"}}', []);
    await screen.findByDisplayValue('f');

    await pickValueType('number');

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(valueBox().value).toBe('12');
    expect(screen.queryByText('Value must be a valid number')).toBeNull();
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"f":{"$eq":12}}'));
  });

  it('keeps a value that does not, with the error, and switching back clears it', async () => {
    await mount('{"f":{"$eq":"abc"}}', []);
    await screen.findByDisplayValue('f');

    await pickValueType('number');

    expect(await screen.findByText('Value must be a valid number')).toBeTruthy();
    expect(valueBox().value).toBe('abc');

    await pickValueType('string');

    await waitFor(() => expect(screen.queryByText('Value must be a valid number')).toBeNull());
    expect(valueBox().value).toBe('abc');
  });
});

describe('the operator moving between one value and a list', () => {
  async function setOperator(text: string) {
    const op = await screen.findByPlaceholderText('$op');
    fireEvent.focus(op);
    fireEvent.change(op, { target: { value: text } });
    fireEvent.blur(op);
  }

  it('= to $in makes the value the first chip', async () => {
    const updateSpy = await mount('{"s":{"$eq":"x"}}', []);
    await screen.findByDisplayValue('x');

    await setOperator('$in');

    expect(await screen.findByRole('button', { name: 'Remove x' })).toBeTruthy();
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$in":["x"]}}'));
    expect(helperNotice()).toBeNull();
  });

  it('$in to = keeps the first chip, names what was removed, and Undo brings the list back', async () => {
    const updateSpy = await mount('{"s":{"$in":["a","b","c"]}}', []);
    await screen.findByRole('button', { name: 'Remove a' });

    await setOperator('=');

    await waitFor(() => expect(valueBox().value).toBe('a'));
    expect(helperNotice()?.textContent).toBe('b, c were removed · Undo');
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$eq":"a"}}'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByRole('button', { name: 'Remove c' })).toBeTruthy();
    expect(helperNotice()).toBeNull();
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$in":["a","b","c"]}}'));
  });

  it('$in to = on a single chip removes nothing and says nothing', async () => {
    await mount('{"s":{"$in":["a"]}}', []);
    await screen.findByRole('button', { name: 'Remove a' });

    await setOperator('=');

    await waitFor(() => expect(valueBox().value).toBe('a'));
    expect(helperNotice()).toBeNull();
  });
});

describe('the helper line priority', () => {
  it('a problem on the value shows before the notice', async () => {
    const { CondValueEditor } = await import('../../src/pages/Workspace/CondValueEditor');
    render(
      <CondValueEditor
        node={{ kind: 'cond', field: 'f', op: '$eq', valType: 'number', value: 'abc' }}
        readOnly={false}
        problem="Value must be a valid number"
        onPatch={vi.fn()}
        onTypeChange={vi.fn()}
        suggestionContext={null}
        wide
        dim={undefined}
        notice={{ kind: 'undo', text: 'Changed to number to match f', actionLabel: 'Undo', onAction: vi.fn() }}
      />,
    );
    expect(screen.getByText('Value must be a valid number')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('the notice runs its action', async () => {
    const { CondValueEditor } = await import('../../src/pages/Workspace/CondValueEditor');
    const onAction = vi.fn();
    render(
      <CondValueEditor
        node={{ kind: 'cond', field: 'f', op: '$eq', valType: 'number', value: '12' }}
        readOnly={false}
        problem={undefined}
        onPatch={vi.fn()}
        onTypeChange={vi.fn()}
        suggestionContext={null}
        wide
        dim={undefined}
        notice={{ kind: 'hint', text: 'f is a number', actionLabel: 'Use number', onAction }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use number' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('a switch row', () => {
  it('a string true that becomes a boolean says so under the switch, and Undo restores the tree', async () => {
    const updateSpy = await mount('{"zzz":{"$eq":"true"}}', Array(10).fill({ flag: true }));
    await screen.findByDisplayValue('zzz');

    await retypeField('flag');

    await waitFor(() => expect(helperNotice()).not.toBeNull());
    expect(screen.getByRole('radio', { name: 'true' })).toBeTruthy();
    expect(helperNotice()?.textContent).toBe('Changed to boolean to match flag · Undo');
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"flag":{"$eq":true}}'));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(valueBox().value).toBe('true'));
    expect(typeChip().textContent).toBe('string');
    expect(helperNotice()).toBeNull();
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"flag":{"$eq":"true"}}'));
  });
});

describe('a field that holds two kinds', () => {
  it('a blank row takes the commoner kind when the field box is left, and shows the split dot', async () => {
    await mount('{}', [...Array(6).fill({ qty: 3 }), ...Array(4).fill({ qty: 'x' })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    const box = await waitFor(() => fieldBox());
    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'qty' } });
    await waitFor(() => expect(document.querySelector('[data-type-split-dot]')).not.toBeNull());
    expect(typeChip().textContent).toBe('string');

    fireEvent.blur(box);

    await waitFor(() => expect(typeChip().textContent).toBe('number'));
    expect(helperNotice()).toBeNull();
  });
});

describe('one helper line under the value box', () => {
  const STRINGS = Array(10).fill({ status: 'a' });

  it('a problem takes the line from the sample note', async () => {
    await mount('{"status":{"$eq":"abc"}}', STRINGS);
    await screen.findByDisplayValue('status');

    await pickValueType('number');

    expect(await screen.findByText('Value must be a valid number')).toBeTruthy();
    expect(screen.queryByText(/^Sample: /)).toBeNull();
  });

  it('the sample note outranks the ObjectId creation time, so only one of them shows', async () => {
    await mount('{"status":{"$eq":{"$oid":"507f1f77bcf86cd799439011"}}}', STRINGS);
    await screen.findByDisplayValue('status');

    expect(await screen.findByText(/^Sample: status is string/)).toBeTruthy();
    expect(screen.queryByText(/^created /)).toBeNull();
  });

  it('the sample note shows alone when nothing more urgent has the line', async () => {
    await mount('{"status":{"$eq":5}}', STRINGS);
    await screen.findByDisplayValue('status');

    expect(await screen.findByText('Sample: status is string in 100% of documents that have it')).toBeTruthy();
    expect(screen.getAllByText(/^Sample: /)).toHaveLength(1);
  });
});

describe('a pattern row and its options', () => {
  const toggle = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

  it('a loaded pattern lights its options and a toggle adds or removes one letter in imsx order', async () => {
    const updateSpy = await mount('{"s":{"$regex":"ab","$options":"i"}}', []);
    await screen.findByDisplayValue('ab');
    expect(toggle('Ignore case').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: /^Multiline/ }) as HTMLButtonElement).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /^Dot also matches/ }));
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$regex":"ab","$options":"is"}}'));

    fireEvent.click(toggle('Ignore case'));
    fireEvent.click(screen.getByRole('button', { name: /^Dot also matches/ }));
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$regex":"ab"}}'));
  });

  it('leaving $regex drops the options, says so, and Undo brings them back', async () => {
    const updateSpy = await mount('{"s":{"$regex":"ab","$options":"im"}}', []);
    await screen.findByDisplayValue('ab');
    const op = await screen.findByPlaceholderText('$op');
    fireEvent.focus(op);
    fireEvent.change(op, { target: { value: '=' } });
    fireEvent.blur(op);

    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$eq":"ab"}}'));
    expect(helperNotice()?.textContent).toBe('Pattern options i, m were removed · Undo');
    expect(screen.queryByRole('group', { name: 'Pattern options' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(lastQuery(updateSpy)).toBe('{"s":{"$regex":"ab","$options":"im"}}'));
  });
});
