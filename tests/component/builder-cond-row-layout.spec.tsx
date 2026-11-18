import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';
import { pickValueType, removeCondition } from '../helpers/condRow';

const now = '2026-08-02T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    // Seeded so the auto-run-on-open effect doesn't fire a background
    // find and desynchronize the call-count assertions below.
    lastRun: { documents: [], durationMs: 0, ranAt: now },
    ...overrides,
  };
}

function makeCollectionTab(state: CollectionTabState): WorkspaceTab {
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

/**
 * Mount Workspace over a single collection tab holding `state`. Returns the
 * `find` spy and the `tabs.update` spy — the latter is how we observe what a
 * UI interaction actually persisted, since tab state is written through IPC.
 */
function mountWith(
  state: CollectionTabState,
  prefs: Record<string, unknown> = {},
) {
  const findSpy = vi.fn<IpcApi['query']['find']>(async () => ({
    documents: [],
    durationMs: 3,
    hasMore: false,
  }));
  const confirmDeleteManySpy = vi.fn<IpcApi['doc']['confirmDeleteMany']>(async () => ({
    count: 0,
    confirmToken: 'tok',
  }));
  const updateSpy = vi.fn(async () => makeCollectionTab(state));

  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    prefs: {
      // Open unless a test stores otherwise: most of these are about the drawer.
      get: async (key: string) => ({ 'ui.workspace.builderCollapsed': false, ...prefs })[key] ?? null,
      set: async () => undefined,
    } as unknown as IpcApi['prefs'],
    query: { find: findSpy, count: async () => ({ count: 0 }) },
    doc: { confirmDeleteMany: confirmDeleteManySpy } as unknown as IpcApi['doc'],
  });

  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, findSpy, confirmDeleteManySpy, updateSpy };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const chip = () => screen.getByRole('button', { name: /^Value type: / });
const box = () => document.querySelector('[data-value-box]') as HTMLElement | null;

describe('condition row, two lines', () => {
  it('shows the type as a sentence-case chip button, not a select', async () => {
    mountWith(makeState({ queryRaw: '{"name":{"$eq":"alice"}}' }));
    await screen.findByDisplayValue('alice');

    expect(chip().textContent).toBe('string');
    expect(chip().getAttribute('aria-label')).toBe('Value type: string');
    expect(screen.queryByLabelText('Value type')).toBeNull();
    // Inside the value box, at its end.
    expect(box()?.contains(chip())).toBe(true);
  });

  it('the chip opens a menu of the types and picking one retypes the row', async () => {
    mountWith(makeState({ queryRaw: '{"name":{"$eq":"alice"}}' }));
    await screen.findByDisplayValue('alice');

    fireEvent.click(chip());
    const items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent);
    expect(items).toEqual(['string', 'number', 'long', 'decimal', 'boolean', 'date', 'null', 'regex', 'objectid', 'array']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'number' }));

    await waitFor(() => expect(chip().textContent).toBe('number'));
  });

  it('retyping to a type that lacks the operator moves the row to one it has', async () => {
    mountWith(makeState({ queryRaw: '{"name":{"$regex":"a"}}' }));
    await screen.findByDisplayValue('a');
    await pickValueType('number');

    await waitFor(() => expect(chip().textContent).toBe('number'));
    expect((screen.getByPlaceholderText('$op') as HTMLInputElement).value).not.toBe('$regex');
  });

  it('has no delete button on the row; Remove is the last item of its menu', async () => {
    mountWith(makeState({ queryRaw: '{"a":{"$eq":1}}' }));
    await screen.findByDisplayValue('a');
    expect(screen.queryByRole('button', { name: /^Remove condition/ })).toBeNull();

    await removeCondition('1');
    await waitFor(() => expect(screen.queryByPlaceholderText('field')).toBeNull());
  });

  it('a string row has no preview line repeating the value', async () => {
    mountWith(makeState({ queryRaw: '{"name":{"$eq":"alice"}}' }));
    await screen.findByDisplayValue('alice');
    expect(screen.queryByText('"alice"')).toBeNull();
  });

  it('a date keeps its preview, as a line under the box', async () => {
    mountWith(makeState({ queryRaw: '{"d":{"$gte":{"$date":"2026-01-01T00:00:00.000Z"}}}' }));
    const preview = await screen.findByText('ISODate("2026-01-01T00:00:00.000Z")');
    expect(box()?.contains(preview)).toBe(false);
  });

  it('a boolean has a true / false switch beside the operator and no value box', async () => {
    mountWith(makeState({ queryRaw: '{"f":{"$eq":true}}' }));
    const group = await screen.findByRole('radiogroup', { name: 'Value' });

    expect(box()).toBeNull();
    expect(screen.queryByPlaceholderText('value')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Value type: / })).toBeNull();
    fireEvent.click(within(group).getByRole('radio', { name: 'false' }));
    await waitFor(() => expect((within(group).getByRole('radio', { name: 'false' }) as HTMLInputElement).checked).toBe(true));
  });

  it('$exists has a present / absent switch and no value box', async () => {
    mountWith(makeState({ queryRaw: '{"f":{"$exists":false}}' }));
    const group = await screen.findByRole('radiogroup', { name: 'Value' });

    expect(box()).toBeNull();
    expect((within(group).getByRole('radio', { name: 'absent' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(group).getByRole('radio', { name: 'present' }));
    await waitFor(() => expect((within(group).getByRole('radio', { name: 'present' }) as HTMLInputElement).checked).toBe(true));
  });

  it('a null row has no value area, and its type stays reachable from the row menu', async () => {
    mountWith(makeState({ queryRaw: '{"n":{"$eq":null}}' }));
    await screen.findByDisplayValue('n');

    expect(box()).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Value' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Condition options 1' }));
    const sub = await screen.findByRole('menuitem', { name: 'Value type' });
    fireEvent.mouseEnter(sub);
    fireEvent.click(sub);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'string' }));

    await waitFor(() => expect(chip().textContent).toBe('string'));
  });

  it('a value problem is a red border on the box and a message under it', async () => {
    mountWith(makeState());
    fireEvent.click(await screen.findByRole('button', { name: 'Add condition' }));
    fireEvent.change(await screen.findByPlaceholderText('field'), { target: { value: 'o' } });
    await pickValueType('objectid');
    fireEvent.change(screen.getByPlaceholderText('value'), { target: { value: 'zzz' } });

    const message = await screen.findByText('ObjectId must be 24 hex characters');
    expect(box()?.style.border).toContain('var(--atelier-red)');
    expect(box()?.contains(message)).toBe(false);
    expect(screen.getByPlaceholderText('value').getAttribute('aria-describedby')).toBe(message.id);
  });
});
