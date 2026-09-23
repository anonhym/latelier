import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * #110 — a React/Mantine effect (e.g. `ModalBase`'s `useLockScroll`, which
 * `ModalsProvider` mounts even while closed) can schedule a `setTimeout`
 * that only fires later, on a real clock. If nothing unmounts the component
 * between tests, that effect's cleanup never runs and the timer outlives
 * the test file: vitest tears down the jsdom globals for the worker, the
 * callback then fires and reads `window` to update React state, and the
 * whole run fails with an uncaught `ReferenceError` even though every test
 * already passed. It surfaces only under load, so it reads as a flake.
 *
 * `tests/helpers/jsdomSetup.ts` (the `component` project's setupFile) covers
 * this for every component spec. It also covers `@mantine/notifications`'
 * 4-6s auto-close timer, which no per-component fix can reach.
 *
 * The `tests/unit/**` files that opt into `@vitest-environment jsdom` for a
 * single hook spec (see e.g. `useRovingFocus.spec.ts`) sit in the `unit`
 * vitest project, which has no setupFiles — most of `unit` runs under plain
 * Node and jsdomSetup.ts touches `window`/`HTMLElement`/`Element`
 * unconditionally, so it can't be added there wholesale. Each such spec
 * calls this directly instead.
 *
 * The handles are recorded rather than swept by id: under vitest's jsdom
 * environment `setTimeout` is Node's, which returns a `Timeout` object
 * instead of the numeric id the DOM spec promises, and `clearTimeout` will
 * not accept that object's id back. Wrapping the globals sidesteps the
 * question.
 *
 * `vi.useFakeTimers()` swaps these wrappers out and `vi.useRealTimers()`
 * puts them back, so timers scheduled against the fake clock are simply
 * never recorded — which is correct, since restoring real timers discards
 * them.
 */
export function installJsdomTeardown(): void {
  const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
  const pendingFrames = new Set<number>();

  const nativeSetTimeout = window.setTimeout;
  const nativeSetInterval = window.setInterval;
  const nativeRequestAnimationFrame = window.requestAnimationFrame;

  window.setTimeout = function recordingSetTimeout(
    ...args: Parameters<typeof nativeSetTimeout>
  ) {
    const handle = nativeSetTimeout.apply(window, args);
    pendingTimers.add(handle);
    return handle;
  } as typeof window.setTimeout;

  window.setInterval = function recordingSetInterval(
    ...args: Parameters<typeof nativeSetInterval>
  ) {
    const handle = nativeSetInterval.apply(window, args);
    pendingTimers.add(handle);
    return handle;
  } as typeof window.setInterval;

  if (typeof nativeRequestAnimationFrame === 'function') {
    window.requestAnimationFrame = function recordingRaf(callback: FrameRequestCallback) {
      const handle = nativeRequestAnimationFrame.call(window, callback);
      pendingFrames.add(handle);
      return handle;
    };
  }

  afterEach(() => {
    cleanup();
    for (const handle of pendingTimers) {
      window.clearTimeout(handle);
      window.clearInterval(handle);
    }
    pendingTimers.clear();
    for (const handle of pendingFrames) window.cancelAnimationFrame(handle);
    pendingFrames.clear();
  });
}
