// The one Agents tab (X30 §4, W01 §15): renderer-only, never sent to tabs:*,
// always last, counted last by ⌘1–⌘9 and ⌘⌥←/→, closed by ⌘W without
// leaving the mode, and it never moves the stored tabs' focus.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '../helpers/render';
import { collectionTabFixture, uninstallAtelierMock } from '../helpers/atelierMock';
import { agentState, mountAgentsWorkspace, token } from '../helpers/agentsWorkspace';
import type { IpcApi } from '@shared/ipc';

afterEach(() => {
  uninstallAtelierMock();
  vi.restoreAllMocks();
});

const TABS = [
  collectionTabFixture({ id: 't1', collection: 'users', position: 0, isActive: true }),
  collectionTabFixture({ id: 't2', collection: 'orders', position: 1 }),
];

/**
 * Records every `api.tabs.*` call from here on, except a stored tab saving
 * its own state: a collection tab's first query run lands a debounced
 * `tabs.update` of its own, whenever the machine gets to it.
 */
function watchTabs(api: IpcApi): string[] {
  const calls: string[] = [];
  const stored = new Set(TABS.map((t) => t.id));
  const tabs = api.tabs as unknown as Record<string, unknown>;
  for (const [name, fn] of Object.entries(tabs)) {
    if (typeof fn !== 'function') continue;
    tabs[name] = (...args: unknown[]) => {
      if (!(name === 'update' && stored.has(args[0] as string))) calls.push(`tabs.${name}(${JSON.stringify(args[0] ?? null)})`);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return calls;
}

const strip = () => screen.findByRole('tablist', { name: 'Open tabs' });
const agentsSegment = async () =>
  within(await screen.findByRole('tablist', { name: 'Sidebar mode' })).getByRole('tab', { name: /^Agents/ });
const mod = (key: string, extra: Record<string, boolean> = {}) => fireEvent.keyDown(window, { key, metaKey: true, ...extra });

async function mountWithAgentsTab() {
  const ws = mountAgentsWorkspace({ tabs: TABS, state: agentState({ tokens: [token('t-a', 'laptop-claude')] }) });
  await within(await strip()).findByRole('tab', { name: /users/ });
  const calls = watchTabs(ws.api);
  fireEvent.click(await agentsSegment());
  await screen.findByTestId('agents-tab');
  return { ...ws, calls };
}

describe('the Agents tab', () => {
  it('is drawn last, and opening other Agents pages reuses it', async () => {
    const { calls } = await mountWithAgentsTab();
    const tabs = within(await strip()).getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toBe(screen.getByTestId('agents-tab'));
    fireEvent.click(screen.getByRole('button', { name: 'Setup & capabilities' }));
    await screen.findByTestId('agents-setup-capabilities');
    fireEvent.click(screen.getByTestId('agents-sidebar-agent'));
    await screen.findByTestId('agents-page-agent');
    expect(screen.getAllByTestId('agents-tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Agents · laptop-claude' })).toBe(screen.getByTestId('agents-tab'));
    expect(calls).toEqual([]);
  });

  it('is not draggable, and no stored tab is selected while it is in front', async () => {
    await mountWithAgentsTab();
    const tab = screen.getByTestId('agents-tab');
    expect(tab.getAttribute('draggable')).toBe('false');
    const selected = within(await strip())
      .getAllByRole('tab')
      .filter((t) => t.getAttribute('aria-selected') === 'true');
    expect(selected).toEqual([tab]);
    expect(screen.getByTestId('agents-breadcrumb').textContent).toBe('Agents›Home');
  });

  it('⌘1–⌘9 count it last, and choosing a stored tab keeps the mode', async () => {
    const { calls } = await mountWithAgentsTab();
    mod('1');
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('false'));
    expect(calls).toContain('tabs.setActive("t1")');
    expect(screen.getByTestId('agents-sidebar')).toBeTruthy();
    calls.splice(0);
    mod('3');
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('true'));
    expect(calls).toEqual([]);
  });

  it('⌘⌥→ and ⌘⌥← step through it in its place, wrapping', async () => {
    const { calls } = await mountWithAgentsTab();
    mod('ArrowRight', { altKey: true });
    await waitFor(() => expect(calls).toContain('tabs.setActive("t1")'));
    calls.splice(0);
    mod('ArrowLeft', { altKey: true });
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('true'));
    expect(calls).toEqual([]);
  });

  it('⌘W closes it, leaves the mode, and the stored tab behind it comes back without being asked for', async () => {
    const { calls } = await mountWithAgentsTab();
    mod('w');
    await waitFor(() => expect(screen.queryByTestId('agents-tab')).toBeNull());
    expect(screen.getByTestId('agents-sidebar')).toBeTruthy();
    expect(calls).toEqual([]);
    expect(within(await strip()).getByRole('tab', { name: /users/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('its close button closes it, and the next switch to Agents opens it again on the page it showed', async () => {
    await mountWithAgentsTab();
    fireEvent.click(screen.getByRole('button', { name: 'Setup & capabilities' }));
    await screen.findByTestId('agents-setup-capabilities');
    fireEvent.click(screen.getByRole('button', { name: 'Close Agents tab' }));
    await waitFor(() => expect(screen.queryByTestId('agents-tab')).toBeNull());
    fireEvent.click(within(await screen.findByRole('tablist', { name: 'Sidebar mode' })).getByRole('tab', { name: /^Databases/ }));
    fireEvent.click(await agentsSegment());
    expect(await screen.findByTestId('agents-setup-capabilities')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Agents · Setup & capabilities' })).toBeTruthy();
  });

  it('clicking a stored tab steps it back, and clicking it brings it forward again, never through tabs:*', async () => {
    const { calls } = await mountWithAgentsTab();
    fireEvent.click(within(await strip()).getByRole('tab', { name: /orders/ }));
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('false'));
    calls.splice(0);
    fireEvent.click(screen.getByTestId('agents-tab'));
    await waitFor(() => expect(screen.getByTestId('agents-tab').getAttribute('aria-selected')).toBe('true'));
    expect(calls).toEqual([]);
  });
});
