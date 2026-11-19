import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor, act } from '../helpers/render';
import { installAtelierMock, uninstallAtelierMock } from '../helpers/atelierMock';
import { PasteWarningStrip } from '../../src/pages/Workspace/PasteWarningStrip';
import {
  getPasteWarning,
  settlePasteWarning,
  showPasteWarning,
} from '../../src/state/pasteWarning';
import type { ConnectionSummary } from '@shared/types';

const openSettings = vi.hoisted(() => vi.fn());
vi.mock('../../src/pages/SettingsContext', () => ({ useSettings: () => ({ open: openSettings }) }));

function conn(over: Partial<ConnectionSummary> & Pick<ConnectionSummary, 'id' | 'name'>): ConnectionSummary {
  return {
    color: '#000',
    host: 'localhost',
    port: 27017,
    connectionType: 'standard',
    readOnly: false,
    status: 'connected',
    familyId: null,
    familyName: null,
    ...over,
  };
}

const FROM = { connectionId: 'conn-a', dbName: 'shop', collection: 'orders' };

function install(connections: ConnectionSummary[]) {
  installAtelierMock({ conn: { list: async () => connections } });
}

/**
 * A tab that holds the Run result as real state, as the workspace does: a Run
 * with documents or without them is a click that settles the warning with the
 * count the state now holds. `onKeyDown` on the parent proves what Escape in
 * the strip does or does not let through.
 */
function Tab({ onParentKeyDown }: { onParentKeyDown: (e: React.KeyboardEvent) => void }) {
  const [documents, setDocuments] = React.useState<unknown[]>([]);
  const run = (found: unknown[]) => {
    setDocuments(found);
    settlePasteWarning('t1', found.length);
  };
  return (
    <div onKeyDown={onParentKeyDown}>
      <button type="button" onClick={() => run([{ _id: 1 }])}>Run with results</button>
      <button type="button" onClick={() => run([])}>Run with nothing</button>
      <span data-testid="count">{documents.length}</span>
      <PasteWarningStrip tabId="t1" connectionId="conn-b" surfaces={['filter', 'sort']} />
    </div>
  );
}

const strip = () => screen.queryByTestId('paste-warning-strip');

async function mount(connections: ConnectionSummary[] = [conn({ id: 'conn-a', name: 'Client A' }), conn({ id: 'conn-b', name: 'Client B' })]) {
  install(connections);
  const onParentKeyDown = vi.fn();
  render(<Tab onParentKeyDown={onParentKeyDown} />);
  return { onParentKeyDown };
}

beforeEach(() => openSettings.mockReset());
afterEach(() => uninstallAtelierMock());

describe('PasteWarningStrip', () => {
  it('shows nothing until the tab holds a warning', async () => {
    await mount();
    expect(strip()).toBeNull();
  });

  it('names both Connections and the Collection the value was copied from, in a status region', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    const region = await screen.findByRole('status');
    await waitFor(() => expect(region.textContent).toContain('Client A'));
    expect(region.textContent).toBe(
      'Copied from Client A · shop.orders. This tab is on Client B.SettingsDismiss',
    );
    expect(region.getAttribute('data-emphasised')).toBeNull();
  });

  it('shows only under a surface it hosts, and a second paste replaces the first', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'projection', FROM));
    expect(strip()).toBeNull();
    act(() => showPasteWarning('t1', 'filter', FROM));
    expect(strip()).not.toBeNull();
    act(() => showPasteWarning('t1', 'sort', { ...FROM, collection: 'invoices' }));
    expect(screen.getAllByTestId('paste-warning-strip')).toHaveLength(1);
    await waitFor(() => expect(strip()!.textContent).toContain('shop.invoices'));
  });

  it('names the Family when both Connections share one', async () => {
    await mount([
      conn({ id: 'conn-a', name: 'Client A', familyId: 'f1', familyName: 'Client deployments' }),
      conn({ id: 'conn-b', name: 'Client B', familyId: 'f1', familyName: 'Client deployments' }),
    ]);
    act(() => showPasteWarning('t1', 'filter', FROM));
    await waitFor(() => expect(strip()!.textContent).toContain('(both in Client deployments)'));
  });

  it('does not name a Family when the Connections are in different ones, or only one is', async () => {
    await mount([
      conn({ id: 'conn-a', name: 'Client A', familyId: 'f1', familyName: 'One' }),
      conn({ id: 'conn-b', name: 'Client B', familyId: 'f2', familyName: 'Two' }),
    ]);
    act(() => showPasteWarning('t1', 'filter', FROM));
    await waitFor(() => expect(strip()!.textContent).toContain('Client A'));
    expect(strip()!.textContent).not.toContain('both in');
  });

  it('Dismiss removes it', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(strip()).toBeNull();
    expect(getPasteWarning('t1')).toBeUndefined();
  });

  it('the Settings link opens the section that holds the switch', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(openSettings).toHaveBeenCalledWith('editor');
  });

  it('Escape inside the strip dismisses it and goes no further', async () => {
    const { onParentKeyDown } = await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    await userEvent.keyboard('{Escape}');
    expect(strip()).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it('another key inside the strip is left alone and bubbles', async () => {
    const { onParentKeyDown } = await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    dismiss.focus();
    await userEvent.keyboard('{Shift}');
    expect(strip()).not.toBeNull();
    expect(onParentKeyDown).toHaveBeenCalled();
  });

  it('goes after a Run with documents', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    await screen.findByTestId('paste-warning-strip');
    await userEvent.click(screen.getByRole('button', { name: 'Run with results' }));
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(strip()).toBeNull();
  });

  it('turns emphatic after a Run with no documents, and stays, even past a Run with results', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    await screen.findByTestId('paste-warning-strip');
    await userEvent.click(screen.getByRole('button', { name: 'Run with nothing' }));
    await waitFor(() => expect(strip()!.textContent).toContain('No results, and this value was copied from Client A.'));
    expect(strip()!.getAttribute('data-emphasised')).toBe('true');
    expect(strip()!.textContent).not.toContain('This tab is on');
    await userEvent.click(screen.getByRole('button', { name: 'Run with results' }));
    expect(strip()).not.toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(strip()).toBeNull();
  });

  it('keeps the Family in the emphatic wording', async () => {
    await mount([
      conn({ id: 'conn-a', name: 'Client A', familyId: 'f1', familyName: 'Client deployments' }),
      conn({ id: 'conn-b', name: 'Client B', familyId: 'f1', familyName: 'Client deployments' }),
    ]);
    act(() => showPasteWarning('t1', 'filter', FROM));
    await screen.findByTestId('paste-warning-strip');
    await userEvent.click(screen.getByRole('button', { name: 'Run with nothing' }));
    await waitFor(() => expect(strip()!.textContent).toContain('No results, and this value was copied from Client A. (both in Client deployments)'));
  });

  it('a Run settles only its own tab', async () => {
    await mount();
    act(() => showPasteWarning('t1', 'filter', FROM));
    act(() => settlePasteWarning('t2', 5));
    expect(getPasteWarning('t1')).toBeDefined();
  });

  it('falls back to neutral names while the Connection list has not named them', async () => {
    await mount([]);
    act(() => showPasteWarning('t1', 'filter', FROM));
    await waitFor(() => expect(strip()!.textContent).toContain('Copied from another connection'));
    expect(strip()!.textContent).toContain('This tab is on this connection.');
  });
});
