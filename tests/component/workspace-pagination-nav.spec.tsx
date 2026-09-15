import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '../helpers/render';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { CollectionTab } from '@shared/types';
import type { IpcApi } from '@shared/ipc';

const now = '2026-05-14T12:00:00.000Z';

function makeCollectionTab(overrides: Partial<CollectionTab> = {}): CollectionTab {
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
    state: {
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
      // Seeded so this tab reads as "already run" — otherwise the
      // auto-run-on-open effect would fire a background find before the
      // "Initial run" click below, desynchronizing the `findSpy` call-count
      // assertions used throughout this file.
      lastRun: { documents: [], durationMs: 0, ranAt: now },
    },
    ...overrides,
  };
}

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function mountWorkspace() {
  return render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
}

describe('Workspace pagination navigation', () => {
  it('Last then First issues finds with correct skip (no stale closure)', async () => {
    // Regression for the closure bug: handlePageChange called runRef.current()
    // without overriding state, so the closure captured by the previous render
    // still read the old `state.page`. Going Last → First would mis-issue the
    // find with skip = lastPage * pageSize.
    //
    // Total of 1284 docs at pageSize=50 → 26 pages, last index = 25,
    // skip on last page = 1250.
    const findSpy = vi.fn<IpcApi['query']['find']>(async () => ({
      documents: Array.from({ length: 50 }, (_, i) => ({
        _id: { $oid: 'a'.repeat(23) + i.toString(16).padStart(1, '0') },
        n: i,
      })),
      durationMs: 5,
      hasMore: true,
    }));

    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab()],
        setActive: async (id) => ({ id }),
        update: async () => makeCollectionTab(),
      },
      conn: {
        list: async () => [
          {
            id: 'c1',
            name: 'Local',
            color: '#1A6835',
            host: 'localhost',
            port: 27017,
            connectionType: 'standard',
            readOnly: false,
            status: 'connected',
          },
        ],
      },
      query: {
        find: findSpy,
        count: async () => ({ count: 1284 }),
      },
    });

    mountWorkspace();

    // Initial run so totalCount can settle (Last button needs totalPages).
    const runBtn = await screen.findByTestId('query-run-btn');
    fireEvent.click(runBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));
    expect(findSpy.mock.calls[0]?.[0]?.skip).toBe(0);

    // Wait for the Last button to become enabled (it gates on totalPages,
    // which only appears after count() resolves).
    const lastBtn = await screen.findByLabelText('Last page');
    await waitFor(() => expect((lastBtn as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(lastBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(2));
    expect(findSpy.mock.calls[1]?.[0]?.skip).toBe(1250);
    expect(findSpy.mock.calls[1]?.[0]?.limit).toBe(50);

    // After landing on the last page, click First — this is where the stale
    // closure bug used to surface. Without the fix the request would carry
    // skip=1250 from the previous render's closure.
    const firstBtn = await screen.findByLabelText('First page');
    await waitFor(() => expect((firstBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(firstBtn);

    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(3));
    expect(findSpy.mock.calls[2]?.[0]?.skip).toBe(0);
    expect(findSpy.mock.calls[2]?.[0]?.limit).toBe(50);
  });

  it('Next advances skip by pageSize and Previous walks it back', async () => {
    const findSpy = vi.fn<IpcApi['query']['find']>(async () => ({
      documents: Array.from({ length: 50 }, (_, i) => ({
        _id: { $oid: 'b'.repeat(23) + i.toString(16).padStart(1, '0') },
        n: i,
      })),
      durationMs: 4,
      hasMore: true,
    }));

    installAtelierMock({
      tabs: {
        list: async () => [makeCollectionTab()],
        setActive: async (id) => ({ id }),
        update: async () => makeCollectionTab(),
      },
      conn: {
        list: async () => [
          {
            id: 'c1',
            name: 'Local',
            color: '#1A6835',
            host: 'localhost',
            port: 27017,
            connectionType: 'standard',
            readOnly: false,
            status: 'connected',
          },
        ],
      },
      query: {
        find: findSpy,
        count: async () => ({ count: 1284 }),
      },
    });

    mountWorkspace();

    const runBtn = await screen.findByTestId('query-run-btn');
    fireEvent.click(runBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(1));

    const nextBtn = await screen.findByLabelText('Next page');
    await waitFor(() => expect((nextBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(nextBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(2));
    expect(findSpy.mock.calls[1]?.[0]?.skip).toBe(50);

    fireEvent.click(nextBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(3));
    expect(findSpy.mock.calls[2]?.[0]?.skip).toBe(100);

    const prevBtn = await screen.findByLabelText('Previous page');
    await waitFor(() => expect((prevBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(prevBtn);
    await waitFor(() => expect(findSpy).toHaveBeenCalledTimes(4));
    expect(findSpy.mock.calls[3]?.[0]?.skip).toBe(50);
  });
});
