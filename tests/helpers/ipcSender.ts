import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { senderCheck } from '../../electron/ipc/senderGuard';

/**
 * The sender identity integration specs run under.
 *
 * `createRouter` takes its sender check as a required argument, so every spec
 * has to supply one. They supply the **real** check rather than `() => true`:
 * a shim that trusts everything puts the security boundary back outside the
 * test suite, which is the state this replaced. With these, all ninety channel
 * tests exercise the guard's allow path, and `router-sender.spec.ts` drives the
 * deny path through a registered channel.
 */

const APP_URL = 'file:///app/dist/index.html';

/** The frame the shims' invoke events come from — stands in for the window's main frame. */
export const appFrame = { url: APP_URL } as unknown as WebFrameMain;

/** A frame that is neither the app's document nor the app's frame object. */
export const foreignFrame = { url: 'https://evil.example/' } as unknown as WebFrameMain;

/** The invoke event a trusted renderer produces. */
export const invokeEvent = { senderFrame: appFrame } as IpcMainInvokeEvent;

/** The invoke event an untrusted one would. */
export const foreignInvokeEvent = { senderFrame: foreignFrame } as IpcMainInvokeEvent;

/** The check to hand `createRouter` in tests. Real logic, test-scoped identity. */
export const testSenderCheck = senderCheck(
  () => appFrame,
  (url) => url.split('#')[0] === APP_URL,
);
