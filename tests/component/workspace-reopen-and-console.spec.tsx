import { describe, it, expect, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { notifications } from '@mantine/notifications';
import { render, screen, fireEvent, waitFor, within } from '../helpers/render';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Workspace from '../../src/pages/Workspace';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import type { IpcApi } from '@shared/ipc';
import type { ConnectionSummary, ScriptTab, WorkspaceTab } from '@shared/types';

const now = '2026-07-26T12:00:00.000Z';

const conn: ConnectionSummary = {
  id: 'c1',
  name: 'Prod',
  color: '#1A6835',
  host: 'localhost',
  port: 27017,
  connectionType: 'standard',
  readOnly: false,
  status: 'connected',
};

function scriptTab(id: string, source: string, isActive = true): ScriptTab {
  return {
    id,
    kind: 'script',
    connectionId: 'c1',
    dbName: '',
    collection: '',
    position: 0,
    isActive,
    openedAt: now,
    pinned: false,
    state: { title: 'Script 1', source, maxTimeMs: 60_000 },
  };
}

afterEach(() => {
  act(() => notifications.clean());
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

function mount(initial: WorkspaceTab[], connGate?: Promise<void>) {
  let rows = initial;
  const openScript = vi.fn<IpcApi['tabs']['openScript']>(async (input) => {
    const tab = { ...scriptTab('t-new', '', true), state: { title: 'Script', source: '', maxTimeMs: 60_000, ...input.initialState } };
    rows = [...rows, tab];
    return tab;
  });
  const start = vi.fn<IpcApi['mshell']['start']>(async () => ({ sessionId: 's1', connectionId: 'c1', startedAt: now }));
  installAtelierMock({
    tabs: {
      list: async () => rows,
      close: async (id: string) => {
        rows = rows.filter((t) => t.id !== id);
        return { newActiveId: null };
      },
      openScript,
    },
    conn: {
      list: async () => {
        if (connGate) await connGate;
        return [conn];
      },
    },
    mshell: { start, write: async () => undefined, stop: async () => undefined, list: async () => [], onOutput: () => () => {} },
  });
  render(
    <MemoryRouter initialEntries={['/workspace']}>
      <Workspace />
    </MemoryRouter>,
  );
  return { openScript, start };
}

describe('Reopening a closed tab (W01 §14.8)', () => {
  it('⌘⇧T brings back the script tab with its source', async () => {
    const { openScript } = mount([scriptTab('t1', 'db.orders.find()')]);
    await userEvent.click(await screen.findByLabelText('Close Script 1'));
    await waitFor(() => expect(screen.queryByLabelText('Close Script 1')).toBeNull());

    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
    await waitFor(() => expect(openScript).toHaveBeenCalledTimes(1));
    expect(openScript.mock.calls[0]![0].initialState!.source).toBe('db.orders.find()');
    await screen.findByLabelText('Close Script 1');
  });

  it('⌘T alone still opens the new-tab picker, not a reopen', async () => {
    const { openScript } = mount([scriptTab('t1', 'x')]);
    await userEvent.click(await screen.findByLabelText('Close Script 1'));
    await waitFor(() => expect(screen.queryByLabelText('Close Script 1')).toBeNull());
    // Something is waiting on the reopen list, so a stray reopen would show.
    fireEvent.keyDown(window, { key: 't', metaKey: true });
    await act(async () => {});
    expect(openScript).not.toHaveBeenCalled();
  });

  it('the tab menu lists "Reopen closed tab": disabled until a tab was closed, then reopens it', async () => {
    const { openScript } = mount([scriptTab('t1', 'db.a.find()'), { ...scriptTab('t2', 'two', false), state: { title: 'Other', source: 'two', maxTimeMs: 60_000 } }]);
    const reopenItem = async () => {
      fireEvent.contextMenu(await screen.findByRole('tab', { name: /^Script 1/ }));
      return within(await screen.findByRole('menu')).getByRole('menuitem', { name: /Reopen closed tab/ });
    };
    const disabled = (el: HTMLElement) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

    expect(disabled(await reopenItem())).toBe(true);
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByLabelText('Close Other'));
    const item = await reopenItem();
    expect(disabled(item)).toBe(false);
    await userEvent.click(item);
    await waitFor(() => expect(openScript).toHaveBeenCalledTimes(1));
  });
});

describe('⌘⇧T edge cases', () => {
  it('says so when nothing was closed', async () => {
    const { openScript } = mount([scriptTab('t1', 'x')]);
    await screen.findByLabelText('Close Script 1');
    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
    expect(await screen.findByText('No closed tab to reopen')).toBeTruthy();
    expect(openScript).not.toHaveBeenCalled();
  });

  it('while connections are still loading, says so and keeps the closed tab for later', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { openScript } = mount([scriptTab('t1', 'db.orders.find()')], gate);
    await userEvent.click(await screen.findByLabelText('Close Script 1'));
    await waitFor(() => expect(screen.queryByLabelText('Close Script 1')).toBeNull());

    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
    expect(await screen.findByText(/Connections are still loading/)).toBeTruthy();
    expect(openScript).not.toHaveBeenCalled();

    await act(async () => release());
    fireEvent.keyDown(window, { key: 'T', metaKey: true, shiftKey: true });
    await waitFor(() => expect(openScript).toHaveBeenCalledTimes(1));
    expect(openScript.mock.calls[0]![0].initialState!.source).toBe('db.orders.find()');
  });

  it('is left alone inside a dialog, like ⌘B', async () => {
    const { openScript } = mount([scriptTab('t1', 'x')]);
    await userEvent.click(await screen.findByLabelText('Close Script 1'));
    await waitFor(() => expect(screen.queryByLabelText('Close Script 1')).toBeNull());
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const field = document.createElement('input');
    dialog.appendChild(field);
    document.body.appendChild(dialog);
    try {
      fireEvent.keyDown(field, { key: 'T', metaKey: true, shiftKey: true });
      await act(async () => {});
      expect(openScript).not.toHaveBeenCalled();
    } finally {
      dialog.remove();
    }
  });
});

describe('The Console (W11 §8.1)', () => {
  it('Ctrl+` toggles the pane from anywhere outside a dialog', async () => {
    const { start } = mount([scriptTab('t1', '1')]);
    await screen.findByLabelText('Close Script 1');
    expect(screen.queryByTestId('mongo-shell-pane')).toBeNull();

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    await screen.findByTestId('mongo-shell-pane');
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    fireEvent.keyDown(window, { key: '`', ctrlKey: true });
    await waitFor(() => expect(screen.queryByTestId('mongo-shell-pane')).toBeNull());
  });

  it('Ctrl+` inside a dialog leaves the pane alone', async () => {
    mount([scriptTab('t1', '1')]);
    await screen.findByLabelText('Close Script 1');
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const field = document.createElement('input');
    dialog.appendChild(field);
    document.body.appendChild(dialog);
    try {
      fireEvent.keyDown(field, { key: '`', ctrlKey: true });
      expect(screen.queryByTestId('mongo-shell-pane')).toBeNull();
    } finally {
      dialog.remove();
    }
  });

  it('the title-bar button reads Console and its tooltip names the shortcut', async () => {
    mount([scriptTab('t1', '1')]);
    const button = await within(screen.getByRole('banner')).findByRole('button', { name: 'Console' });
    await userEvent.hover(button);
    expect(await screen.findByText('Interactive shell for the focused connection (⌃`)')).toBeTruthy();
  });
});
