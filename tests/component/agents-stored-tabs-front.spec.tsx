// Every way a person brings a stored tab forward steps the Agents tab back
// first (X30 §4), reusing the tab already in front included; a stored tab
// that comes forward on its own does not.
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '../helpers/render';
import { useStoredTabsFront } from '../../src/features/agents/useStoredTabsFront';
import type { WorkspaceTabsState } from '../../src/state/workspaceTabs';

function setup(reopened = true) {
  const order: string[] = [];
  const step = (name: string) =>
    vi.fn(async () => {
      order.push(name);
      return name === 'reopenClosed' ? reopened : { id: 't1' };
    });
  const tabs = {
    tabs: [],
    activeId: 't1',
    openCollection: step('openCollection'),
    openAggregation: step('openAggregation'),
    openScript: step('openScript'),
    openServer: step('openServer'),
    setActive: step('setActive'),
    reopenClosed: step('reopenClosed'),
    close: step('close'),
  } as unknown as WorkspaceTabsState;
  const unfocus = vi.fn(() => order.push('unfocus'));
  const { result } = renderHook(() => useStoredTabsFront(tabs, unfocus));
  return { front: result.current, order, unfocus, tabs };
}

describe('useStoredTabsFront', () => {
  it('steps the Agents tab back before each open, reuse and choice, and passes the call through', async () => {
    const { front, order, tabs } = setup();
    const input = { connectionId: 'c1', dbName: 'db', collection: 'users', reuseExisting: true };
    expect(await front.openCollection(input)).toEqual({ id: 't1' });
    expect(tabs.openCollection).toHaveBeenCalledWith(input);
    await front.openAggregation({ connectionId: 'c1', dbName: 'db', collection: 'users' });
    await front.openScript({ connectionId: 'c1' } as never);
    await front.openServer({ connectionId: 'c1' });
    await front.setActive('t2');
    expect(tabs.setActive).toHaveBeenCalledWith('t2');
    expect(order).toEqual([
      'unfocus', 'openCollection',
      'unfocus', 'openAggregation',
      'unfocus', 'openScript',
      'unfocus', 'openServer',
      'unfocus', 'setActive',
    ]);
  });

  it('steps it back on a reopen only once a tab did come back', async () => {
    const none = setup(false);
    expect(await none.front.reopenClosed(() => true)).toBe(false);
    expect(none.unfocus).not.toHaveBeenCalled();
    const one = setup(true);
    expect(await one.front.reopenClosed(() => true)).toBe(true);
    expect(one.unfocus).toHaveBeenCalledTimes(1);
  });

  it('leaves the rest alone: a close lets the neighbour come forward behind the Agents tab', async () => {
    const { front, unfocus, tabs } = setup();
    await front.close('t1');
    expect(tabs.close).toHaveBeenCalledWith('t1');
    expect(unfocus).not.toHaveBeenCalled();
    expect(front.activeId).toBe('t1');
  });
});
