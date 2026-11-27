/**
 * The time strings of Agents mode, with the clock passed in so every caller,
 * and every test, reads the same "now".
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

/** "just now", "5m ago", "3h ago", "2d ago", "3w ago", then the date; `fallback` for a missing or bad time. */
export function ago(iso: string | null | undefined, now: number, fallback = ''): string {
  const t = parse(iso);
  if (t === null) return fallback;
  const delta = now - t;
  if (delta < MINUTE) return 'just now';
  const mins = Math.floor(delta / MINUTE);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/** How long since `iso`, short: "just now", "34 min", "2 h", "3 d". */
export function elapsedShort(iso: string | null | undefined, now: number): string {
  const t = parse(iso);
  if (t === null) return '';
  const delta = now - t;
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} min`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)} h`;
  return `${Math.floor(delta / DAY)} d`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local wall-clock time, "09:12". */
export function clock(iso: string | null | undefined): string {
  const t = parse(iso);
  if (t === null) return '';
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "today", "yesterday", else "Nov 25" (local calendar days). */
export function dayWord(iso: string | null | undefined, now: number): string {
  const t = parse(iso);
  if (t === null) return '';
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  const d = new Date(t);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
