// W15 §14.5 / §1.2 — feedback while composing: a debounced match count under
// the filter tree, and a line saying where sort / limit / skip / projection
// moved. Counts are asserted through `api.query.count` (what was actually
// asked of the main process) and through the status line the user reads.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTabState, WorkspaceTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-10-15T12:00:00.000Z';

function makeTab(queryRaw: string): WorkspaceTab {
  const state: CollectionTabState = {
    view: 'Tree',
    builder: { projection: [], sort: '', limit: '' },
    queryRaw,
    page: 0,
    pageSize: 50,
    activeBuilderTab: 'Builder',
    lastRun: { documents: [], durationMs: 0, ranAt: now },
  };
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

type CountFn = IpcApi['query']['count'];

function mountWith(queryRaw: string, count: CountFn) {
  const countSpy = vi.fn<CountFn>(count);
  const tab = makeTab(queryRaw);
  installAtelierMock({
    tabs: {
      list: async () => [tab],
      setActive: async (id) => ({ id }),
      update: (async () => tab) as unknown as IpcApi['tabs']['update'],
    },
    conn: { list: async () => [CONNECTION] },
    query: {
      find: async () => ({ documents: [], durationMs: 3, hasMore: false }),
      count: countSpy,
    },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return countSpy;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Resolves a count call from outside, so a test controls response order. */
function deferred() {
  let resolve!: (v: { count: number }) => void;
  const promise = new Promise<{ count: number }>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

describe('Filter drawer — live match count (W15 §14.5)', () => {
  it('shows the count of the committed filter once typing settles', async () => {
    const count = mountWith('{"a":{"$eq":1}}', async () => ({ count: 1240 }));
    await screen.findByPlaceholderText('field');

    await advance(500);

    const status = await screen.findByText(/match$/);
    expect(status.textContent).toBe(`≈${(1240).toLocaleString()} match`);
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0].filter).toBe('{"a":{"$eq":1}}');
  });

  it('says it is counting before the answer arrives', async () => {
    const d = deferred();
    mountWith('{"a":{"$eq":1}}', () => d.promise);
    await screen.findByPlaceholderText('field');

    await advance(500);

    expect(await screen.findByText('Counting…')).toBeTruthy();
    d.resolve({ count: 3 });
    expect(await screen.findByText('≈3 match')).toBeTruthy();
  });

  it('asks nothing for an empty filter', async () => {
    const count = mountWith('{}', async () => ({ count: 7 }));
    await screen.findByLabelText('Drop a field here to add a condition');

    await advance(2000);

    expect(count).not.toHaveBeenCalled();
    expect(screen.queryByText(/match$/)).toBeNull();
    expect(screen.queryByText('Counting…')).toBeNull();
  });

  it('counts once, for the last value, when edits arrive faster than the debounce', async () => {
    const count = mountWith('{"a":{"$eq":1}}', async () => ({ count: 2 }));
    const value = (await screen.findByDisplayValue('1')) as HTMLInputElement;
    await advance(500);
    count.mockClear();

    for (const v of ['2', '3', '4']) {
      fireEvent.change(value, { target: { value: v } });
      await advance(30);
    }
    await advance(500);

    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0].filter).toBe('{"a":{"$eq":4}}');
  });

  it('stops asking while an edit is not applied', async () => {
    const count = mountWith('{"qty":{"$gt":5}}', async () => ({ count: 2 }));
    const value = (await screen.findByDisplayValue('5')) as HTMLInputElement;
    await advance(500);
    count.mockClear();

    fireEvent.change(value, { target: { value: 'not-a-number' } });
    await advance(1000);

    expect(screen.getByText(/not applied/)).toBeTruthy();
    expect(count).not.toHaveBeenCalled();
    expect(screen.queryByText(/match$/)).toBeNull();
  });

  it('keeps the newest answer when an older one arrives late', async () => {
    const a = deferred();
    const b = deferred();
    const count = mountWith('{"a":{"$eq":1}}', async () => ({ count: 0 }));
    const value = (await screen.findByDisplayValue('1')) as HTMLInputElement;
    count.mockReset();
    count.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    // The mount-time call has not fired yet (500 ms), so edit first, then let
    // exactly two calls through: one for each settled filter.
    await advance(500);
    fireEvent.change(value, { target: { value: '2' } });
    await advance(500);
    expect(count).toHaveBeenCalledTimes(2);

    b.resolve({ count: 5 });
    await advance(0);
    a.resolve({ count: 9 });
    await advance(0);

    expect(await screen.findByText('≈5 match')).toBeTruthy();
    expect(screen.queryByText('≈9 match')).toBeNull();
  });

  it('says the count is unavailable on failure and does not ask again', async () => {
    const count = mountWith('{"a":{"$eq":1}}', async () => {
      throw new Error('timed out');
    });
    const value = (await screen.findByDisplayValue('1')) as HTMLInputElement;
    await advance(500);

    expect(await screen.findByText('Match count unavailable')).toBeTruthy();
    expect(count).toHaveBeenCalledTimes(1);

    fireEvent.change(value, { target: { value: '2' } });
    await advance(1000);

    expect(count).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Match count unavailable')).toBeTruthy();
  });
});

describe('Filter drawer — pointer to the other query controls (W15 §1.2)', () => {
  it('says where sort, limit, skip and projection are edited', async () => {
    mountWith('{}', async () => ({ count: 0 }));

    const note = await screen.findByText(/sort, limit and skip are set in the query bar/i);
    expect(note.textContent).toMatch(/projection is under fields/i);
  });
});
