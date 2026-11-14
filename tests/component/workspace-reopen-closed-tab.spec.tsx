import { describe, it, expect, afterEach, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import { renderHook, act, waitFor, screen, fireEvent } from '../helpers/render';
import { useWorkspaceTabs } from '../../src/state/workspaceTabs';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { IpcApi } from '@shared/ipc';
import type { ScriptTab, WorkspaceTab } from '@shared/types';

const now = '2026-04-21T12:00:00.000Z';

function scriptTab(id: string, source: string, over: Partial<ScriptTab> = {}): ScriptTab {
  return {
    id,
    kind: 'script',
    connectionId: 'c1',
    dbName: '',
    collection: '',
    position: 0,
    isActive: true,
    openedAt: now,
    pinned: false,
    state: { title: 'Script 1', source, maxTimeMs: 60_000, lastResult: { valueJson: '1', printBuffer: '', durationMs: 1 } },
    ...over,
  };
}

afterEach(() => {
  act(() => notifications.clean());
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

/** A tab store that behaves like main: list, close and openScript share one array. */
function installStore(initial: WorkspaceTab[]) {
  let rows = initial;
  let n = 100;
  const openScript = vi.fn<IpcApi['tabs']['openScript']>(async (input) => {
    const tab = scriptTab(`t${++n}`, '', {
      connectionId: input.connectionId,
      state: { title: 'Script', source: '', maxTimeMs: 60_000, ...input.initialState },
    });
    rows = [...rows, tab];
    return tab;
  });
  installAtelierMock({
    tabs: {
      list: async () => rows,
      close: async (id: string) => {
        rows = rows.filter((t) => t.id !== id);
        return { newActiveId: null };
      },
      openScript,
    },
  });
  return { openScript, rows: () => rows };
}

async function mountHook() {
  const hook = renderHook(() => useWorkspaceTabs());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const live = () => true;

describe('useWorkspaceTabs — closed tabs (W01 §14.8)', () => {
  it('reopens a closed script tab with its source and title, and without its last run', async () => {
    const { openScript } = installStore([scriptTab('t1', 'db.orders.find()')]);
    const { result } = await mountHook();
    expect(result.current.closedCount).toBe(0);

    await act(() => result.current.close('t1'));
    expect(result.current.closedCount).toBe(1);

    let reopened = false;
    await act(async () => {
      reopened = await result.current.reopenClosed(live);
    });
    expect(reopened).toBe(true);
    expect(openScript).toHaveBeenCalledTimes(1);
    const seed = openScript.mock.calls[0]![0].initialState!;
    expect(seed.source).toBe('db.orders.find()');
    expect(seed.title).toBe('Script 1');
    expect(seed.lastResult).toBeUndefined();
    expect(result.current.closedCount).toBe(0);
  });

  it('reopens newest first and says false when nothing is left', async () => {
    const { openScript } = installStore([scriptTab('t1', 'one'), scriptTab('t2', 'two', { isActive: false })]);
    const { result } = await mountHook();
    await act(() => result.current.close('t1'));
    await act(() => result.current.close('t2'));

    await act(async () => void (await result.current.reopenClosed(live)));
    expect(openScript.mock.calls[0]![0].initialState!.source).toBe('two');
    await act(async () => void (await result.current.reopenClosed(live)));
    expect(openScript.mock.calls[1]![0].initialState!.source).toBe('one');
    let again = true;
    await act(async () => {
      again = await result.current.reopenClosed(live);
    });
    expect(again).toBe(false);
  });

  it('skips a tab whose Connection is gone', async () => {
    const { openScript } = installStore([
      scriptTab('t1', 'kept'),
      scriptTab('t2', 'gone', { connectionId: 'c-removed', isActive: false }),
    ]);
    const { result } = await mountHook();
    await act(() => result.current.close('t1'));
    await act(() => result.current.close('t2'));

    await act(async () => void (await result.current.reopenClosed((id) => id === 'c1')));
    expect(openScript).toHaveBeenCalledTimes(1);
    expect(openScript.mock.calls[0]![0].initialState!.source).toBe('kept');
  });

  it('offers Undo in a toast for a script holding source, and Undo reopens it once', async () => {
    const { openScript } = installStore([scriptTab('t1', 'db.orders.find()')]);
    const { result } = await mountHook();
    await act(() => result.current.close('t1'));

    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(openScript).toHaveBeenCalledTimes(1));
    expect(openScript.mock.calls[0]![0].initialState!.source).toBe('db.orders.find()');
    // It left the reopen list: ⌘⇧T does not bring it back a second time.
    await waitFor(() => expect(result.current.closedCount).toBe(0));
  });

  it('shows no Undo toast for a blank script', async () => {
    installStore([scriptTab('t1', '   \n')]);
    const { result } = await mountHook();
    await act(() => result.current.close('t1'));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(result.current.closedCount).toBe(1);
  });
});
