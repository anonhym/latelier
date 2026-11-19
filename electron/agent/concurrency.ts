import { AgentToolError } from './errorMap.ts';

/** X27 §6.4: two operations run per Connection, up to four more wait. */
export const MAX_RUNNING = 2;
export const MAX_WAITING = 4;

interface Waiter {
  grant: () => void;
}

/**
 * The per-Connection cap on Agent operations. A call takes a slot, or waits in
 * a short queue for one, or is refused with BUSY. A waiter whose signal aborts
 * leaves the queue with CANCELLED, so a revoked call never holds a place.
 */
export class Semaphore {
  private running = 0;
  private queue: Waiter[] = [];
  private maxRunning: number;
  private maxWaiting: number;

  constructor(maxRunning = MAX_RUNNING, maxWaiting = MAX_WAITING) {
    this.maxRunning = maxRunning;
    this.maxWaiting = maxWaiting;
  }

  /** Resolves with an idempotent `release`. */
  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new AgentToolError('CANCELLED'));
    if (this.running < this.maxRunning) {
      this.running += 1;
      return Promise.resolve(this.releaser());
    }
    if (this.queue.length >= this.maxWaiting) return Promise.reject(new AgentToolError('BUSY'));
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        this.queue = this.queue.filter((w) => w !== waiter);
        reject(new AgentToolError('CANCELLED'));
      };
      const waiter: Waiter = {
        grant: () => {
          signal.removeEventListener('abort', onAbort);
          resolve(this.releaser());
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  /** True when nothing runs and nothing waits, so the owner can forget this semaphore. */
  get idle(): boolean {
    return this.running === 0 && this.queue.length === 0;
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) {
        // The slot passes straight to the next waiter: `running` stays as it is.
        next.grant();
      } else {
        this.running -= 1;
      }
    };
  }
}
