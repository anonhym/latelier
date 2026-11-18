// The condition row's field, operator and value boxes: Escape stays with the
// box instead of closing the Inspector, every way out of the field box types
// the row like the sampled field, and no row carries an operator help button.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { pickValueType } from '../helpers/condRow';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { invalidateSampleSchemaCache } from '../../src/features/fieldSuggestions/sources/sampleSchemaSource';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-09T12:00:00.000Z';

function makeState(): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
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

async function openRow(): Promise<void> {
  const state = makeState();
  installAtelierMock({
    tabs: {
      list: async () => [makeTab(state)],
      setActive: async (id) => ({ id }),
      update: (vi.fn(async () => makeTab(state)) as unknown) as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
    meta: {
      sampleSchema: vi.fn(async () => ({ docs: Array(10).fill({ qty: 3, cnt: 4 }) })) as unknown as IpcApi['meta']['sampleSchema'],
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
  await screen.findByPlaceholderText('field');
}

const fieldBox = () => screen.getByPlaceholderText('field') as HTMLInputElement;
// The type chip in the value box: its text is the type, its label says so.
const typeBox = () => {
  const chip = document.querySelector('button[aria-label^="Value type: "]') as HTMLButtonElement;
  return { value: chip.textContent, click: () => chip.click() };
};

beforeEach(() => invalidateSampleSchemaCache());
afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Escape in a condition box', () => {
  it.each(['field', '$op', 'value'])('in the %s box leaves the Inspector open', async (placeholder) => {
    await openRow();
    const box = screen.getByPlaceholderText(placeholder);
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Filter' })).toBeTruthy();
  });

  it('in the field box with its list open only closes the list', async () => {
    await openRow();
    const box = fieldBox();
    box.focus();
    fireEvent.change(box, { target: { value: 'q' } });
    await screen.findByRole('listbox', { name: 'Field suggestions' });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox', { name: 'Field suggestions' })).toBeNull());
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(document.activeElement).toBe(box);
  });

  it('in the field box with no list leaves the box', async () => {
    await openRow();
    const box = fieldBox();
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(document.activeElement).not.toBe(box);
    expect(screen.getByTestId('inspector')).toBeTruthy();
  });
});

describe('Leaving the field box types the row like the sampled field', () => {
  async function pickSampledField() {
    await openRow();
    const box = fieldBox();
    box.focus();
    fireEvent.change(box, { target: { value: 'qty' } });
    await screen.findByText('Sample: qty is number in 100% of documents that have it');
    expect(typeBox().value).toBe('string');
    return box;
  }

  it('on Tab', async () => {
    const box = await pickSampledField();
    await screen.findByRole('listbox', { name: 'Field suggestions' });
    fireEvent.keyDown(box, { key: 'Tab' });
    await waitFor(() => expect(typeBox().value).toBe('number'));
  });

  it('on Escape', async () => {
    const box = await pickSampledField();
    // Close the list first so this Escape is the one that leaves the box.
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(box, { key: 'Escape' });
    await waitFor(() => expect(typeBox().value).toBe('number'));
  });

  it('on a click away', async () => {
    const box = await pickSampledField();
    fireEvent.blur(box);
    await waitFor(() => expect(typeBox().value).toBe('number'));
  });

  it('on clicking a suggestion', async () => {
    await pickSampledField();
    fireEvent.click(await screen.findByRole('option', { name: /qty/ }));
    await waitFor(() => expect(typeBox().value).toBe('number'));
  });

  it('never retypes a row that already holds a value', async () => {
    const box = await pickSampledField();
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'abc' } });
    fireEvent.blur(box);
    expect(typeBox().value).toBe('string');
  });
});

describe('A type chosen by hand', () => {
  it('survives tabbing through an unedited field box, and yields to an edited one', async () => {
    await openRow();
    const box = fieldBox();
    fireEvent.change(box, { target: { value: 'qty' } });
    await screen.findByText('Sample: qty is number in 100% of documents that have it');
    fireEvent.blur(box);
    await waitFor(() => expect(typeBox().value).toBe('number'));

    await pickValueType('string');
    await waitFor(() => expect(typeBox().value).toBe('string'));

    fireEvent.focus(box);
    fireEvent.blur(box);
    expect(typeBox().value).toBe('string');

    fireEvent.focus(box);
    fireEvent.change(box, { target: { value: 'cnt' } });
    fireEvent.blur(box);
    await waitFor(() => expect(typeBox().value).toBe('number'));
  });
});

describe('Operator help', () => {
  it('no row carries a documentation button, whatever its operator', async () => {
    await openRow();
    expect(screen.queryByLabelText(/Documentation for/)).toBeNull();
    const op = screen.getByPlaceholderText('$op') as HTMLInputElement;
    expect(op.value).toBe('=');
  });
});
