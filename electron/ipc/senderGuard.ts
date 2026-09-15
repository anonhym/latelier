import type { IpcMainInvokeEvent, WebFrameMain } from 'electron';

/**
 * Decides whether an `invoke` came from the app's own top-level document.
 *
 * It is deliberately the last layer rather than the first. The window refuses
 * to open child windows, refuses to navigate off its own document, and serves
 * a CSP with `frame-src 'none'` — so in a correct build there is exactly one
 * frame and this never fires. It is here for the build that is not correct.
 */

/** The frame a message must come from: the window's own main frame. */
export type TrustedFrame = () => WebFrameMain | null;

export type SenderCheck = (evt: Pick<IpcMainInvokeEvent, 'senderFrame'>) => boolean;

export function isTrustedSender(
  evt: Pick<IpcMainInvokeEvent, 'senderFrame'>,
  trusted: TrustedFrame,
  isAppLocation: (url: string) => boolean,
): boolean {
  const expected = trusted();
  // The `expected !== null` half is not redundant, and it is the whole reason
  // this is not a bare identity check: `expected` is null before the window
  // exists and after it is destroyed, `evt.senderFrame` is null once the
  // sending frame is disposed, and `null === null` would read those two
  // absences as a match.
  //
  // Electron caches one `WebFrameMain` per (processId, routingId), so a reload
  // leaves both sides resolving to the same new object.
  if (expected === null || evt.senderFrame !== expected) return false;

  // Identity alone is not enough, and this is the half that is easy to miss.
  // `trusted()` returns the window's *current* main frame. If a top-level
  // navigation ever replaced the document, the foreign page's `senderFrame`
  // and the window's `mainFrame` would be the very same object, and an
  // identity check would call it trusted. Comparing the location is what
  // separates "our document" from "whatever happens to be loaded".
  return isAppLocation(expected.url);
}

/**
 * Builds the check the router applies to every channel.
 *
 * Nothing else should construct one: a router built without it is a compile
 * error, which is the property that keeps the guard from being quietly dropped
 * from production wiring while every test stays green.
 */
export function senderCheck(
  trusted: TrustedFrame,
  isAppLocation: (url: string) => boolean,
): SenderCheck {
  return (evt) => isTrustedSender(evt, trusted, isAppLocation);
}
