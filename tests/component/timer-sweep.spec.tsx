import { describe, expect, it } from 'vitest';

// Guards the harness sweep in `tests/helpers/jsdomSetup.ts`.
//
// The bug it prevents is only observable across a test boundary: a timer
// scheduled during one test that is still pending when the environment is torn
// down. Asserting inside a single test proves nothing — the timer works with or
// without the sweep. So the check is split: schedule here, assert there.
//
// Without `clearPendingTimers()` in `afterEach`, `fired` is `true` by the time
// the second test looks at it.
let fired = false;

describe('jsdom harness timer sweep', () => {
  it('schedules a timer that outlives its test', () => {
    window.setTimeout(() => {
      fired = true;
    }, 10);
    expect(fired).toBe(false);
  });

  it('does not let the previous test’s timer fire', async () => {
    await new Promise((resolve) => {
      window.setTimeout(resolve, 50);
    });
    expect(fired).toBe(false);
  });

  it('leaves timers scheduled within a single test working', async () => {
    let ranInline = false;
    await new Promise((resolve) => {
      window.setTimeout(() => {
        ranInline = true;
        resolve(undefined);
      }, 5);
    });
    expect(ranInline).toBe(true);
  });
});
