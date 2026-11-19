import { describe, it, expect } from 'vitest';
import { evaluateGates } from '../../electron/agent/gate';

const STATUSES = ['connected', 'connecting', 'disconnected', 'error'] as const;

describe('evaluateGates', () => {
  it('is ok only with access on, the Connection shared and the Connection open', () => {
    expect(evaluateGates({ accessOn: true, shared: true, status: 'connected' })).toBe('ok');
  });

  it.each(STATUSES.filter((s) => s !== 'connected'))('refuses a shared Connection that is %s as NOT_OPEN', (status) => {
    expect(evaluateGates({ accessOn: true, shared: true, status })).toBe('NOT_OPEN');
  });

  it('refuses an unshared Connection as NOT_SHARED, open or not', () => {
    expect(evaluateGates({ accessOn: true, shared: false, status: 'connected' })).toBe('NOT_SHARED');
    expect(evaluateGates({ accessOn: true, shared: false, status: 'disconnected' })).toBe('NOT_SHARED');
  });

  it('refuses everything as ACCESS_OFF while Agent Access is off', () => {
    for (const shared of [true, false]) {
      for (const status of STATUSES) {
        expect(evaluateGates({ accessOn: false, shared, status })).toBe('ACCESS_OFF');
      }
    }
  });

  it('reports Agent Access before the share flag before the status', () => {
    expect(evaluateGates({ accessOn: false, shared: false, status: 'error' })).toBe('ACCESS_OFF');
    expect(evaluateGates({ accessOn: true, shared: false, status: 'error' })).toBe('NOT_SHARED');
  });
});
