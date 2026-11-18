const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * The moment an ObjectId was made: its first four bytes are seconds since the
 * epoch. Null when the text is not exactly 24 hex digits.
 */
export function objectIdTimestamp(hex: string): Date | null {
  if (!OBJECT_ID_HEX.test(hex)) return null;
  return new Date(Number.parseInt(hex.slice(0, 8), 16) * 1000);
}

/**
 * `2026-11-18 08:01:24 EST`: date, 24-hour time and the zone's short name, in
 * the given IANA time zone, or the machine's own when none is given. The zone
 * is an argument so a time-zone setting can pass the person's choice. An
 * unknown zone name throws a RangeError rather than falling back silently.
 */
export function formatLocalDateTime(date: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl.DateTimeFormat gave no ${type} part for ${date.toISOString()}`);
    return part.value;
  };
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} ${get('timeZoneName')}`;
}
