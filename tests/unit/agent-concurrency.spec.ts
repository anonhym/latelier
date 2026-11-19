import { getEventListeners } from 'node:events';
import { describe, it, expect } from 'vitest';
import { MAX_RUNNING, MAX_WAITING, Semaphore } from '../../electron/agent/concurrency';

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A promise's state without awaiting it, so a test can say "still waiting". */
function track<T>(promise: Promise<T>) {
  const state = { settled: false, value: undefined as T | undefined, error: undefined as unknown };
  promise.then(
    (value) => {
      state.settled = true;
      state.value = value;
    },
    (error: unknown) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

const live = () => new AbortController().signal;

describe('Semaphore', () => {
  it('takes the limits from X27 §6.4: two running, four waiting', () => {
    expect(MAX_RUNNING).toBe(2);
    expect(MAX_WAITING).toBe(4);
  });

  it('admits two at once and makes the third wait', async () => {
    const s = new Semaphore();
    await s.acquire(live());
    await s.acquire(live());
    const third = track(s.acquire(live()));
    await flush();
    expect(third.settled).toBe(false);
  });

  it('hands a freed slot to the oldest waiter, first come first served', async () => {
    const s = new Semaphore();
    const release = await s.acquire(live());
    await s.acquire(live());
    const order: number[] = [];
    const a = s.acquire(live()).then(() => order.push(1));
    const b = s.acquire(live()).then(() => order.push(2));
    release();
    await a;
    expect(order).toEqual([1]);
    expect(track(b).settled).toBe(false);
  });

  it('refuses the seventh concurrent call with BUSY and keeps the six in place', async () => {
    const s = new Semaphore();
    const held = [await s.acquire(live()), await s.acquire(live())];
    const waiting = Array.from({ length: 4 }, () => track(s.acquire(live())));
    await expect(s.acquire(live())).rejects.toMatchObject({ code: 'BUSY' });
    await flush();
    expect(waiting.every((w) => !w.settled)).toBe(true);
    held[0]!();
    await flush();
    expect(waiting.filter((w) => w.settled)).toHaveLength(1);
  });

  it('keeps the number of running operations at two while slots pass to waiters', async () => {
    const s = new Semaphore();
    const first = await s.acquire(live());
    await s.acquire(live());
    const queued = track(s.acquire(live()));
    first();
    await flush();
    expect(queued.settled).toBe(true);
    // Two still run (the second and the waiter): a new call must wait.
    const next = track(s.acquire(live()));
    await flush();
    expect(next.settled).toBe(false);
  });

  it('frees the slot when the last waiter is served and nothing is queued', async () => {
    const s = new Semaphore();
    const a = await s.acquire(live());
    const b = await s.acquire(live());
    a();
    b();
    const c = track(s.acquire(live()));
    const d = track(s.acquire(live()));
    await flush();
    expect(c.settled && d.settled).toBe(true);
  });

  it('lets a waiter that aborts leave the queue with CANCELLED, so its place is free again', async () => {
    const s = new Semaphore(1, 1);
    await s.acquire(live());
    const ctrl = new AbortController();
    const waiter = s.acquire(ctrl.signal);
    await expect(s.acquire(live())).rejects.toMatchObject({ code: 'BUSY' });
    ctrl.abort();
    await expect(waiter).rejects.toMatchObject({ code: 'CANCELLED' });
    const again = track(s.acquire(live()));
    await flush();
    expect(again.settled).toBe(false);
    expect(again.error).toBeUndefined();
  });

  it('does not run a waiter that was aborted when a slot frees up', async () => {
    const s = new Semaphore(1, 2);
    const release = await s.acquire(live());
    const ctrl = new AbortController();
    const aborted = s.acquire(ctrl.signal);
    const kept = track(s.acquire(live()));
    ctrl.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'CANCELLED' });
    release();
    await flush();
    expect(kept.settled).toBe(true);
    expect(kept.error).toBeUndefined();
  });

  it('refuses an already-aborted signal with CANCELLED even when a slot is free', async () => {
    const s = new Semaphore();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(s.acquire(ctrl.signal)).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(s.idle).toBe(true);
  });

  it('stops listening to a waiter signal once it has been served', async () => {
    const s = new Semaphore(1, 1);
    const release = await s.acquire(live());
    const ctrl = new AbortController();
    const waiter = s.acquire(ctrl.signal);
    release();
    await waiter;
    // Aborting after the grant must not throw or free a slot twice.
    ctrl.abort();
    const next = track(s.acquire(live()));
    await flush();
    expect(next.settled).toBe(false);
  });

  it('makes release idempotent', async () => {
    const s = new Semaphore(1, 1);
    const release = await s.acquire(live());
    release();
    release();
    await s.acquire(live());
    const second = track(s.acquire(live()));
    await flush();
    expect(second.settled).toBe(false);
  });

  it('is idle only when nothing runs and nothing waits', async () => {
    const s = new Semaphore(1, 1);
    expect(s.idle).toBe(true);
    const release = await s.acquire(live());
    expect(s.idle).toBe(false);
    const waiter = s.acquire(live());
    release();
    expect(s.idle).toBe(false);
    (await waiter)();
    expect(s.idle).toBe(true);
  });

  it('is idle again after a waiter aborts while another call runs only when that call ends', async () => {
    const s = new Semaphore(1, 1);
    const release = await s.acquire(live());
    const ctrl = new AbortController();
    const waiter = s.acquire(ctrl.signal);
    ctrl.abort();
    await expect(waiter).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(s.idle).toBe(false);
    release();
    expect(s.idle).toBe(true);
  });

  it('holds no listener on a waiter signal once it is served, or once it has aborted', async () => {
    const s = new Semaphore(1, 2);
    const release = await s.acquire(live());
    const served = new AbortController();
    const aborted = new AbortController();
    const first = s.acquire(served.signal);
    const second = s.acquire(aborted.signal);
    expect(getEventListeners(served.signal, 'abort')).toHaveLength(1);
    expect(getEventListeners(aborted.signal, 'abort')).toHaveLength(1);
    release();
    await first;
    expect(getEventListeners(served.signal, 'abort')).toHaveLength(0);
    aborted.abort();
    await expect(second).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(getEventListeners(aborted.signal, 'abort')).toHaveLength(0);
  });

  it('is not idle while a waiter is queued, even when nothing runs', () => {
    const s = new Semaphore(0, 1);
    const waiter = s.acquire(live());
    expect(s.idle).toBe(false);
    track(waiter);
  });
});
