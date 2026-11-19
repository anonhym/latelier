import { containsDistinctive, MAX_SCAN_CHARS } from './distinctiveValues';

/** What a paste decision needs to know about the last data-bearing copy. */
export interface PasteOrigin {
  connectionId: string;
  distinctive: readonly string[];
}

export interface PasteCheck {
  /** The last data-bearing in-app copy, or null when there is none. */
  origin: PasteOrigin | null;
  /** The Connection of the Focused Tab. */
  focusedConnectionId: string;
  pasted: string;
  /** The user's preference. */
  enabled: boolean;
}

/**
 * Whether a paste into a query surface is a Cross-Connection Paste: the
 * preference is on, a copy is remembered from a different Connection, and the
 * pasted text carries one of its distinctive values. A different Collection of
 * the same Connection never counts, and Connections of one Family are no
 * exception.
 */
export function isCrossConnectionPaste({ origin, focusedConnectionId, pasted, enabled }: PasteCheck): boolean {
  if (!enabled || origin === null) return false;
  if (origin.connectionId === focusedConnectionId) return false;
  const scanned = pasted.slice(0, MAX_SCAN_CHARS);
  return origin.distinctive.some((value) => containsDistinctive(scanned, value));
}
