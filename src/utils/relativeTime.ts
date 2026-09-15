/**
 * Human-readable "time ago" string for an ISO-8601 timestamp.
 * Returns `fallback` when the input is missing or unparseable so callers
 * can pick the empty/em-dash variant that fits their layout.
 */
export function relativeTime(iso?: string, fallback = ''): string {
  if (!iso) return fallback;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return fallback;
  const delta = Date.now() - t;
  if (delta < 0 || delta < 60_000) return 'just now';
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(iso).toISOString().slice(0, 10);
}
