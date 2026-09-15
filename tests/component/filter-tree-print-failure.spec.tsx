// W13 §11 — "filter-tree-print-failure.spec.tsx: a bad value leaves
// `queryRaw` untouched and surfaces the row message." Also covers §5's "N
// not applied" header badge and the "invalid JSON in the bar freezes the
// drawer read-only" behaviour of §6a.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-08-04T12:00:00.000Z';

function makeState(overrides: Partial<CollectionTabState> = {}): CollectionTabState {
  return {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw: '{}',
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
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

function mountWith(state: CollectionTabState) {
  const updateSpy = vi.fn(async () => makeCollectionTab(state));
  installAtelierMock({
    tabs: {
      list: async () => [makeCollectionTab(state)],
      setActive: async (id) => ({ id }),
      update: updateSpy as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: vi.fn(async () => ({ documents: [], durationMs: 1, hasMore: false })),
      count: async () => ({ count: 0 }),
    },
  });
  const utils = render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { ...utils, updateSpy };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Filter drawer — print failure (W13 §5, §11)', () => {
  it('a bad value leaves queryRaw untouched, surfaces the row message, and shows the "N not applied" badge', async () => {
    const { updateSpy } = mountWith(makeState({ queryRaw: '{"qty":{"$gt":5}}' }));
    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    expect(bar.value).toBe('{"qty":{"$gt":5}}');

    const valueInput = (await screen.findByPlaceholderText('value')) as HTMLInputElement;
    expect(valueInput.value).toBe('5');
    fireEvent.change(valueInput, { target: { value: 'not-a-number' } });

    // The row surfaces the problem inline…
    await waitFor(() => {
      expect(screen.getByText(/valid number/i)).toBeTruthy();
    });
    // …the header badge counts it…
    expect(screen.getByRole('status').textContent).toContain('1 not applied');
    // …and the bar (== queryRaw) is untouched — still the last good value,
    // not the mangled edit and not blanked either.
    expect(bar.value).toBe('{"qty":{"$gt":5}}');

    // Give the 250ms-debounced tabs.update a generous window: even if it
    // fires, it must never have carried the bad value.
    await new Promise((r) => setTimeout(r, 350));
    for (const call of updateSpy.mock.calls as unknown[][]) {
      const patch = (call[1] as { state?: Partial<CollectionTabState> } | undefined)?.state;
      if (patch && 'queryRaw' in patch) {
        expect(patch.queryRaw).toBe('{"qty":{"$gt":5}}');
      }
    }
  });

  it('fixing the value clears the problem and the badge, and prints normally', async () => {
    mountWith(makeState({ queryRaw: '{"qty":{"$gt":5}}' }));
    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;

    const valueInput = await screen.findByPlaceholderText('value');
    fireEvent.change(valueInput, { target: { value: 'nope' } });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 not applied'));

    fireEvent.change(valueInput, { target: { value: '10' } });

    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
      expect(JSON.parse(bar.value)).toEqual({ qty: { $gt: 10 } });
    });
  });

  it('invalid JSON in the bar freezes the drawer read-only on the last valid tree rather than blanking it', async () => {
    mountWith(makeState({ queryRaw: '{"status":{"$eq":"paid"}}' }));

    const fieldInput = (await screen.findByPlaceholderText('field')) as HTMLInputElement;
    expect(fieldInput.value).toBe('status');

    const bar = (await screen.findByTestId('query-bar-input')) as HTMLTextAreaElement;
    fireEvent.change(bar, { target: { value: 'not valid json{{{' } });

    // The banner appears…
    await screen.findByText(/isn't valid JSON/);
    // …the last valid tree is still showing (not blanked)…
    expect((screen.getByPlaceholderText('field') as HTMLInputElement).value).toBe('status');
    // …and it's read-only: the field input is disabled, so a "fix" typed
    // into the frozen tree can't silently overwrite the bar's invalid text.
    expect(fieldInput).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Add condition' })).toHaveProperty('disabled', true);
  });
});
