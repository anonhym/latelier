import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetTabRequestsForTests,
  consumeTabRequest,
  tabRequested,
  requestTab,
  subscribeTabRequests,
} from '../../src/pages/Workspace/tabRequest';

afterEach(() => _resetTabRequestsForTests());

describe('tab requests', () => {
  it('keeps each kind apart: a request of one kind is not another, nor consumed by it', () => {
    requestTab('export', 't1');
    requestTab('explain', 't2');
    requestTab('runPipeline', 't3');
    expect(tabRequested('explain', 't1')).toBe(false);
    expect(tabRequested('runPipeline', 't2')).toBe(false);
    consumeTabRequest('explain', 't1');
    expect(tabRequested('export', 't1')).toBe(true);
    consumeTabRequest('export', 't1');
    expect(tabRequested('explain', 't2')).toBe(true);
    expect(tabRequested('runPipeline', 't3')).toBe(true);
  });

  it('resets every kind for tests', () => {
    requestTab('explain', 't1');
    requestTab('runPipeline', 't1');
    _resetTabRequestsForTests();
    expect(tabRequested('explain', 't1')).toBe(false);
    expect(tabRequested('runPipeline', 't1')).toBe(false);
  });

  it('holds one request, for one tab, until that tab consumes it', () => {
    expect(tabRequested('export', 't1')).toBe(false);
    requestTab('export', 't1');
    expect(tabRequested('export', 't1')).toBe(true);
    expect(tabRequested('export', 't2')).toBe(false);
    consumeTabRequest('export', 't2');
    expect(tabRequested('export', 't1')).toBe(true);
    consumeTabRequest('export', 't1');
    expect(tabRequested('export', 't1')).toBe(false);
  });

  it('replaces an older request with a newer one', () => {
    requestTab('export', 't1');
    requestTab('export', 't2');
    expect(tabRequested('export', 't1')).toBe(false);
    expect(tabRequested('export', 't2')).toBe(true);
  });

  it('notifies subscribers on a request, until they unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeTabRequests(cb);
    requestTab('export', 't1');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    requestTab('export', 't1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resets for tests', () => {
    requestTab('export', 't1');
    _resetTabRequestsForTests();
    expect(tabRequested('export', 't1')).toBe(false);
  });
});
