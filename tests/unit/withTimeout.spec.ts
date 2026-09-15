import { describe, it, expect } from 'vitest';
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
    // smoke-test: no unhandled timer leaks — vitest would flag.
    await withTimeout(Promise.resolve('done'), 60_000, 'fallback');
  });
});
