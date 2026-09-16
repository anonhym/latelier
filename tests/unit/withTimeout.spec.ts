import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from '../../electron/utils/withTimeout';

describe('withTimeout', () => {
  it('resolves with the promise value if it settles before the deadline', async () => {
    const v = await withTimeout(Promise.resolve(42), 100, 0);
    expect(v).toBe(42);
  });

  it('returns the fallback after the timeout', async () => {
    const start = Date.now();
    const v = await withTimeout(
      new Promise<number>((resolve) => setTimeout(() => resolve(99), 500)),
      50,
      -1,
    );
    expect(v).toBe(-1);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('propagates rejection if the promise rejects before deadline', async () => {
    const rejecting = Promise.reject(new Error('boom'));
    await expect(withTimeout(rejecting, 100, 0)).rejects.toThrow('boom');
  });

  it('clears the timer when the promise resolves first', async () => {
    // The `finally` block is the whole point: without it a 60-second timer
    // stays armed after the winning promise has already resolved, which is
    // what kept the Electron main process alive past a fast health check.
    // `getTimerCount` observes that directly; the old version of this test
    // only ran the function and asserted nothing.
    vi.useFakeTimers();
    try {
      const v = await withTimeout(Promise.resolve('done'), 60_000, 'fallback');
      expect(v).toBe('done');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
