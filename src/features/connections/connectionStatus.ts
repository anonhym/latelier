import { themeVars } from '../../theme/themeVars';
import { isConnectionActive } from '../../state/connections';
import type { ConnectionSummary } from '@shared/types';

/**
 * How each status presents itself, in every channel at once — the band's
 * colour, the words a screen reader gets, and a short visible
 * label for a table cell. One table rather than separate switches per
 * channel, so a status can never be given a band and no sentence, or the two
 * can never disagree.
 *
 * `label` and `spoken` differ only for `error`: `spoken` is a full sentence
 * meant to stand alone in a `VisuallyHidden` description (the popover's own
 * use), while `label` is column-width text for the expanded table — reusing
 * `spoken` there would put "Last connection attempt failed" in a cell next to
 * "Connected".
 *
 * `unknown` and `disconnected` share a presentation on purpose: `useConnections()`
 * already folds `disconnected` into `unknown` for the summary, and to a user
 * both mean "there is no client for this right now".
 *
 * Shared between `ConnectionSwitcher` (the popover) and `ConnectionExpandedTable`
 * — a live status vocabulary that could drift between the two would
 * mean a Connection reading "Connected" in one and "Not connected" in the
 * other. Its own file rather than exported from `ConnectionSwitcher` because
 * that file's fast-refresh boundary must only export components.
 */
export const STATUS_PRESENTATION: Record<
  ConnectionSummary['status'],
  { band: string; spoken: string; label: string; live: boolean }
> = {
  connected: {
    band: themeVars.greenDot,
    spoken: 'Connected',
    label: 'Connected',
    // Is there a client to drop? `isConnectionActive` is the canonical
    // answer (`connecting` counts too — the pool exposes the in-flight
    // client precisely so an attempt can be aborted) — computed here rather
    // than duplicated so the two predicates can't drift apart.
    live: isConnectionActive('connected'),
  },
  connecting: {
    band: themeVars.accent,
    spoken: 'Connecting',
    label: 'Connecting',
    live: isConnectionActive('connecting'),
  },
  error: {
    band: themeVars.warn,
    spoken: 'Last connection attempt failed',
    label: 'Error',
    live: isConnectionActive('error'),
  },
  disconnected: {
    band: themeVars.border,
    spoken: 'Not connected',
    label: 'Not connected',
    live: isConnectionActive('disconnected'),
  },
  unknown: {
    band: themeVars.border,
    spoken: 'Not connected',
    label: 'Not connected',
    live: isConnectionActive('unknown'),
  },
};

/**
 * The popover and the expanded table both filter the same Connection
 * list on the same query — one predicate, so "identically to the popover's"
 * (its own acceptance criterion) can never quietly drift into two.
 */
export function matchesConnectionQuery(c: ConnectionSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return c.name.toLowerCase().includes(q) || c.host.toLowerCase().includes(q);
}
