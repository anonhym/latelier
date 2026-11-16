// Display helpers for the update surfaces (X22 §4, §5, §7): the pill, the
// Settings card and the palette commands. Plain functions, so the component
// files export nothing but components (react-refresh).

import type { UpdateState } from '@shared/types';

/** Where the Linux "Off" copy sends the reader (X22 §5.3). */
export const RELEASES_URL = 'https://github.com/anonhym/latelier/releases';

/** The full release history, opened from Settings. */
export const CHANGELOG_URL = 'https://github.com/anonhym/latelier/blob/main/CHANGELOG.md';

/** The line shown beside the Check button, after the relative time. */
export const CHECK_SCHEDULE_NOTE = 'checks at launch and every 4 hours';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** When the last check settled, or null before the first one (and while off). */
export function lastCheckedAt(state: UpdateState): string | null {
  switch (state.status) {
    case 'off':
    case 'idle':
      return null;
    default:
      return state.lastCheckedAt;
  }
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * "just now", "2 minutes ago" (`long`) or "2 min ago" (`short`). An
 * unparseable timestamp reads as null, so a caller never shows "NaN".
 */
export function relativeAgo(iso: string, nowMs: number, style: 'long' | 'short'): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const minutes = Math.floor(Math.max(0, nowMs - t) / MS_PER_MINUTE);
  if (minutes < 1) return 'just now';
  if (minutes < MINUTES_PER_HOUR) return style === 'long' ? `${plural(minutes, 'minute')} ago` : `${minutes} min ago`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  if (hours < HOURS_PER_DAY) return style === 'long' ? `${plural(hours, 'hour')} ago` : `${hours} h ago`;
  const days = Math.floor(hours / HOURS_PER_DAY);
  return style === 'long' ? `${plural(days, 'day')} ago` : `${days} d ago`;
}

/** "Last checked 2 minutes ago · checks at launch and every 4 hours". */
export function checkedLine(state: UpdateState, nowMs: number): string {
  const at = lastCheckedAt(state);
  const ago = at === null ? null : relativeAgo(at, nowMs, 'long');
  return `${ago === null ? 'Not checked yet' : `Last checked ${ago}`} · ${CHECK_SCHEDULE_NOTE}`;
}

/** The palette hint on Check for updates: "last checked 3 min ago". */
export function paletteHint(state: UpdateState, nowMs: number): string {
  const at = lastCheckedAt(state);
  const ago = at === null ? null : relativeAgo(at, nowMs, 'short');
  return ago === null ? 'not checked yet' : `last checked ${ago}`;
}

/** Why the Check button is disabled while the state is `off` (X22 §5.3), as plain text. */
export function offReasonText(reason: 'development' | 'linux'): string {
  return reason === 'linux'
    ? "Updates aren't available on Linux yet. Download new versions from GitHub."
    : 'Updates are off in development builds.';
}

/** "today at 14:02", "yesterday at 09:30" or "on 12 Nov 2026 at 09:30", in local time. */
export function formatDownloaded(iso: string, nowMs: number): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  const now = new Date(nowMs);
  const clock = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const daysAgo = Math.round((dayStart(now) - dayStart(d)) / (MS_PER_MINUTE * MINUTES_PER_HOUR * HOURS_PER_DAY));
  if (daysAgo === 0) return `today at ${clock}`;
  if (daysAgo === 1) return `yesterday at ${clock}`;
  return `on ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} at ${clock}`;
}

export interface StatusCard {
  tone: 'accent' | 'neutral' | 'warning';
  title: string;
  detail: string | null;
  /** Whole percent, for the downloading bar. */
  percent: number | null;
  spinner: boolean;
  icon: 'check' | 'warning' | null;
  /** The button on the card, when it has one. */
  action: 'restart' | 'retry' | null;
}

/** The Settings status card for a state (X22 §5.2); null for `idle` and `off`, which show only the button. */
export function statusCard(state: UpdateState, current: string, nowMs: number): StatusCard | null {
  const base = { detail: null, percent: null, spinner: false, icon: null, action: null } as const;
  switch (state.status) {
    case 'ready': {
      const when = formatDownloaded(state.downloadedAt, nowMs);
      return {
        ...base,
        tone: 'accent',
        title: `Version ${state.version} is ready to install`,
        detail: when === null ? null : `Downloaded ${when}.`,
        action: 'restart',
      };
    }
    case 'up-to-date': {
      const ago = relativeAgo(state.lastCheckedAt, nowMs, 'long');
      const latest = `${current} is the latest version.`;
      return {
        ...base,
        tone: 'neutral',
        icon: 'check',
        title: "You're up to date",
        detail: ago === null ? latest : `${latest} Checked ${ago}.`,
      };
    }
    case 'checking':
      return { ...base, tone: 'neutral', title: 'Checking for updates…', spinner: true };
    case 'downloading':
      return {
        ...base,
        tone: 'neutral',
        title: `Downloading ${state.version}`,
        detail: "Keep working; you'll be offered a restart when it's done.",
        percent: clampPercent(state.percent),
      };
    case 'failed':
      return {
        ...base,
        tone: 'warning',
        icon: 'warning',
        title: "Couldn't check for updates",
        detail: state.message,
        action: 'retry',
      };
    case 'idle':
    case 'off':
      return null;
  }
}

/** A progress value as a whole percent in 0–100; a non-number reads as 0. */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, Math.round(percent)));
}

export interface CheckOutcome {
  kind: 'info' | 'success' | 'error';
  message: string;
}

/**
 * The one toast a palette-started check ends with (X22 §7). `checking` is a
 * check that was already running, `idle` and `off` cannot follow a check: none
 * of them has an outcome to report.
 */
export function checkOutcome(state: UpdateState): CheckOutcome | null {
  switch (state.status) {
    case 'up-to-date':
      return { kind: 'success', message: "You're up to date" };
    case 'downloading':
      return { kind: 'info', message: `Found ${state.version}, downloading` };
    case 'ready':
      return { kind: 'success', message: 'Update ready' };
    case 'failed':
      return { kind: 'error', message: `Couldn't check for updates: ${state.message}` };
    case 'idle':
    case 'checking':
    case 'off':
      return null;
  }
}

/** "macOS", "Windows", "Linux"; any other platform name comes back as given. */
export function platformLabel(platform: string): string {
  switch (platform) {
    case 'darwin':
      return 'macOS';
    case 'win32':
      return 'Windows';
    case 'linux':
      return 'Linux';
    default:
      return platform;
  }
}

/** "Apple silicon" / "Intel" on macOS, "ARM64" / "x64" elsewhere; any other value comes back as given. */
export function archLabel(platform: string, arch: string): string {
  const mac = platform === 'darwin';
  if (arch === 'arm64') return mac ? 'Apple silicon' : 'ARM64';
  if (arch === 'x64') return mac ? 'Intel' : 'x64';
  return arch;
}

/** The Settings identity line: "Version 0.19.1 · macOS · Apple silicon". */
export function identityLine(version: string, platform: string, arch: string): string {
  return `Version ${version} · ${platformLabel(platform)} · ${archLabel(platform, arch)}`;
}
