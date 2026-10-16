// Pure helpers behind the filter tree's type-aware value editors (W15 §14.3).
// A condition's value is always text (`CondNode.value`); these convert between
// that text and what each editor shows, without React.

export const SIMPLE_OPS: ReadonlySet<string> = new Set(['$eq', '$ne', '$gt', '$gte', '$lt', '$lte']);
export const ARRAY_VALUE_OPS: ReadonlySet<string> = new Set(['$in', '$nin', '$all']);

export function isObjectIdHex(s: string): boolean {
  return /^[0-9a-f]{24}$/i.test(s.trim());
}

export type DatePresetId = 'now' | 'startOfToday' | '7d' | '30d' | 'startOfMonth';

export const DATE_PRESETS: { id: DatePresetId; label: string }[] = [
  { id: 'now', label: 'Now' },
  { id: 'startOfToday', label: 'Start of today' },
  { id: '7d', label: '7 days ago' },
  { id: '30d', label: '30 days ago' },
  { id: 'startOfMonth', label: 'Start of this month' },
];

const DAY_MS = 86_400_000;

/**
 * The ISO timestamp a date preset stands for at `now`. "N days ago" is exact
 * elapsed time; the day and month boundaries are local midnight, which is
 * what a person means by "today".
 */
export function datePresetValue(id: DatePresetId, now: Date): string {
  switch (id) {
    case 'now':
      return now.toISOString();
    case 'startOfToday':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    case '7d':
      return new Date(now.getTime() - 7 * DAY_MS).toISOString();
    case '30d':
      return new Date(now.getTime() - 30 * DAY_MS).toISOString();
    case 'startOfMonth':
      return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  }
}

/** A `datetime-local` input's text (local time) as an ISO timestamp; `''` when it isn't a date. */
export function localInputToIso(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** An ISO timestamp as a `datetime-local` input's `YYYY-MM-DDTHH:mm`, local time; `''` when it isn't a date. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export type Chip = string | number | boolean | null;

function isChip(v: unknown): v is Chip {
  if (typeof v === 'number') {
    // An integer past 2^53 has already been rounded by `JSON.parse`; writing
    // it back from a chip would send the rounded number. The text input
    // keeps the digits the user typed.
    return !Number.isInteger(v) || Number.isSafeInteger(v);
  }
  return v === null || typeof v === 'string' || typeof v === 'boolean';
}

/**
 * The chips a `$in` / `$nin` / `$all` value shows, or `null` when the value
 * holds something a chip can't show faithfully (a sub-document, an EJSON
 * sentinel, text that isn't a JSON array), which keeps the text input.
 */
export function chipsFromValue(value: string): Chip[] | null {
  if (value.trim() === '') return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  }
  // Stryker disable next-line BlockStatement: emptied, the catch leaves
  // `parsed` undefined, which the `Array.isArray` check below refuses the
  // same way — the early return only says so sooner.
  catch {
    return null;
  }
  return Array.isArray(parsed) && parsed.every(isChip) ? parsed : null;
}

// Two digit runs that can't be re-split against each other: no super-linear
// backtracking on a long run of digits.
const NUMBER_TEXT = /^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * What a typed chip means: a number, `true` / `false` / `null`, or a string.
 * Quoting (`"42"`) is how a person asks for the string.
 */
export function parseChipText(t: string): Chip {
  const s = t.trim();
  if (NUMBER_TEXT.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  return jsonString(s) ?? s;
}

/** `s` read as a JSON string literal, or `null` when it is any other text. */
function jsonString(s: string): string | null {
  let v: unknown;
  try {
    v = JSON.parse(s);
  }
  // Stryker disable next-line BlockStatement: emptied, the catch leaves `v`
  // undefined, which the `typeof` check below turns into the same `null`.
  catch {
    return null;
  }
  return typeof v === 'string' ? v : null;
}

/** A chip's label: quoted only when the bare text would read back as something else. */
export function chipText(el: Chip): string {
  if (typeof el !== 'string') return String(el);
  return parseChipText(el) === el ? el : JSON.stringify(el);
}

export function valueFromChips(els: Chip[]): string {
  return JSON.stringify(els);
}
