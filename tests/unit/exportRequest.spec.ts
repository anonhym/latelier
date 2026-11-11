import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetExportRequestForTests,
  consumeExport,
  exportRequested,
  requestExport,
  subscribeExport,
} from '../../src/pages/Workspace/exportRequest';

afterEach(() => _resetExportRequestForTests());

describe('export request', () => {
  it('holds one request, for one tab, until that tab consumes it', () => {
    expect(exportRequested('t1')).toBe(false);
    requestExport('t1');
    expect(exportRequested('t1')).toBe(true);
    expect(exportRequested('t2')).toBe(false);
    consumeExport('t2');
    expect(exportRequested('t1')).toBe(true);
    consumeExport('t1');
    expect(exportRequested('t1')).toBe(false);
  });

  it('replaces an older request with a newer one', () => {
    requestExport('t1');
    requestExport('t2');
    expect(exportRequested('t1')).toBe(false);
    expect(exportRequested('t2')).toBe(true);
  });

  it('notifies subscribers on a request, until they unsubscribe', () => {
    const cb = vi.fn();
    const off = subscribeExport(cb);
    requestExport('t1');
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    requestExport('t1');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resets for tests', () => {
    requestExport('t1');
    _resetExportRequestForTests();
    expect(exportRequested('t1')).toBe(false);
  });
});
