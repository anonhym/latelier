import { describe, it, expect } from 'vitest';
import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { isTrustedSender, senderCheck } from '../../electron/ipc/senderGuard';

const APP = 'file:///app/dist/index.html';

/** Frames are compared by identity, so the fakes only need a `url` and to be distinct objects. */
const frame = (url: string) => ({ url }) as unknown as WebFrameMain;

const evt = (senderFrame: WebFrameMain | null) =>
  ({ senderFrame }) as Pick<IpcMainInvokeEvent, 'senderFrame'>;

const isAppLocation = (url: string) => url.split('#')[0] === APP;

describe('isTrustedSender', () => {
  it('accepts the window main frame on the app document', () => {
    const main = frame(APP);
    expect(isTrustedSender(evt(main), () => main, isAppLocation)).toBe(true);
  });

  it('accepts the app document with a HashRouter fragment', () => {
    const main = frame(`${APP}#/workspace`);
    expect(isTrustedSender(evt(main), () => main, isAppLocation)).toBe(true);
  });

  it('rejects a different frame even when its url matches', () => {
    const main = frame(APP);
    const impostor = frame(APP);
    expect(isTrustedSender(evt(impostor), () => main, isAppLocation)).toBe(false);
  });

  // The hole identity alone cannot see. If a top-level navigation ever replaced
  // the document, the foreign page's frame IS the window's current main frame —
  // one object, passing an identity check, serving someone else's content.
  it('rejects the current main frame once it holds a foreign document', () => {
    const navigated = frame('https://evil.example/');
    expect(isTrustedSender(evt(navigated), () => navigated, isAppLocation)).toBe(false);
  });

  it('rejects a disposed sender frame', () => {
    const main = frame(APP);
    expect(isTrustedSender(evt(null), () => main, isAppLocation)).toBe(false);
  });

  it('rejects everything while there is no window', () => {
    expect(isTrustedSender(evt(frame(APP)), () => null, isAppLocation)).toBe(false);
  });

  // The case a bare identity check gets wrong: both sides absent. A disposed
  // frame messaging during teardown, when the window is already gone, would
  // otherwise compare `null === null` and come back trusted.
  it('rejects a disposed frame when there is also no window', () => {
    expect(isTrustedSender(evt(null), () => null, isAppLocation)).toBe(false);
  });
});

describe('senderCheck', () => {
  it('binds the frame getter and the location check into one predicate', () => {
    const main = frame(APP);
    const check = senderCheck(() => main, isAppLocation);
    expect(check(evt(main))).toBe(true);
    expect(check(evt(frame('https://evil.example/')))).toBe(false);
  });

  it('re-reads the frame on every call rather than capturing it', () => {
    // A reload replaces the WebFrameMain object. Capturing once would reject
    // every message after the first reload.
    let current = frame(APP);
    const check = senderCheck(() => current, isAppLocation);
    expect(check(evt(current))).toBe(true);

    const afterReload = frame(APP);
    current = afterReload;
    expect(check(evt(afterReload))).toBe(true);
  });
});
