// Display helpers for the What's new window. Plain functions, so the window's
// component file exports nothing but the component (react-refresh).

import type { ReleaseItem } from './changelog';

/** The changelog's full-history page, opened from the window's footer. */
export const FULL_CHANGELOG_URL = 'https://github.com/anonhym/latelier/blob/main/CHANGELOG.md';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-13" as "13 Nov 2026"; anything else comes back unchanged. */
export function formatReleaseDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number.parseInt(m[2], 10) - 1];
  return month ? `${Number.parseInt(m[3], 10)} ${month} ${m[1]}` : iso;
}

/** The header's second line: the update that just landed, or the version being reread. */
export function whatsNewSubtitle(from: string | null, current: string, releaseCount: number): string {
  if (from === null) return `Version ${current}`;
  return `Updated from ${from} to ${current} · ${releaseCount} ${releaseCount === 1 ? 'release' : 'releases'}`;
}

/**
 * Splits an item's full text into its bold lead and the rest, so Show details
 * keeps the emphasis. The lead's closing period was normalized, so only the
 * part before it is matched against the text.
 */
export function splitLead(item: ReleaseItem): { strong: string; rest: string } {
  if (item.lead === null) return { strong: '', rest: item.text };
  const core = item.lead.endsWith('.') ? item.lead.slice(0, -1) : item.lead;
  return item.text.startsWith(core)
    ? { strong: core, rest: item.text.slice(core.length) }
    : { strong: '', rest: item.text };
}
