// What a field that holds two kinds changes in a condition row (the "a field
// with two types" board): which kinds the chip menu lists, what the helper line
// says about a typed value, and the `$in` that matches either kind. Pure; the
// value editor applies the results.
import type { ValType } from '@shared/types';
import { VAL_TYPES, parseChipText, valueFromChips, type Chip } from './condValue';
import { convertValue } from './kindChange';
import type { TypeShare } from './fieldTypeSplit';

/**
 * How the "Match either" shortcut behaves. One object, so a setting can drive
 * it later: `offered` shows the button under the hint and the chip menu's
 * "either" entry.
 */
export interface MatchEitherOptions {
  offered: boolean;
}

export const MATCH_EITHER_OPTIONS: Readonly<MatchEitherOptions> = { offered: true };

/** A field counts as mixed while no sampled type holds this share of it (the 90% `checkFieldType` calls dominant). */
export const MIXED_BELOW_PERCENT = 90;

export function isMixedSplit(split: readonly TypeShare[]): boolean {
  const top = split[0];
  return top !== undefined && split.length >= 2 && top.share < MIXED_BELOW_PERCENT;
}

/** The row type a sampled type is edited as, or null when it has no editor. */
export function valTypeOfSampled(type: string): ValType | null {
  return (VAL_TYPES as readonly string[]).includes(type) ? (type as ValType) : null;
}

/** Sampled types that are no `ValType` but are not a gap either: documents are edited as raw clauses. */
const NOT_A_GAP: ReadonlySet<string> = new Set(['object', 'undefined']);

/** The commonest sampled type when it has no editor (`binary`, `timestamp`, ...), else null. */
export function noEditorType(split: readonly TypeShare[]): string | null {
  const top = split[0];
  if (!top || valTypeOfSampled(top.type) !== null || NOT_A_GAP.has(top.type)) return null;
  return top.type;
}

export function noEditorText(type: string): string {
  const what = type === 'binary' ? 'binary data' : `${type} values`;
  return `No editor for ${what}: what you type is compared as text. Use a raw clause for $${type}.`;
}

const NUMBER_FAMILY: ReadonlySet<string> = new Set(['number', 'long', 'decimal']);

/** Types MongoDB compares as one: a number matches a long and a decimal holding the same value. */
function sameFamily(a: string, b: string): boolean {
  return a === b || (NUMBER_FAMILY.has(a) && NUMBER_FAMILY.has(b));
}

/** Whether `text`, typed in a `from` row, reads as the sampled type `type`. */
function holds(text: string, from: ValType, type: string): boolean {
  const to = valTypeOfSampled(type);
  return to !== null && convertValue(text, from, to).kind === 'converted';
}

const PLAIN_DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/**
 * Whether the JS number `n` is exactly the number `text` writes. A double
 * keeps about 17 digits, so a longer text (or an integer past 2^53) would be
 * sent as another value; an exponent spelling is withheld rather than guessed.
 * Padding zeros do not count (`007` and `1.50` are `7` and `1.5`).
 */
function numberHoldsText(n: number, text: string): boolean {
  const m = PLAIN_DECIMAL.exec(text.trim());
  if (!m) return false;
  const [, sign, int = '', frac = ''] = m;
  let end = frac.length;
  while (end > 0 && frac[end - 1] === '0') end -= 1;
  const fraction = frac.slice(0, end);
  const written = `${sign}${int.replace(/^0+(?=\d)/, '')}${fraction === '' ? '' : `.${fraction}`}`;
  return written === String(n);
}

/** The `$in` chip a sampled type makes of `text`, or null when no plain chip says it faithfully. */
function chipFor(text: string, type: string): Chip | null {
  if (type === 'string') return text;
  if (NUMBER_FAMILY.has(type)) {
    const chip = parseChipText(text, 'array');
    return typeof chip === 'number' && numberHoldsText(chip, text) ? chip : null;
  }
  if (type === 'boolean') {
    const chip = parseChipText(text, 'array');
    return typeof chip === 'boolean' ? chip : null;
  }
  return null;
}

export interface EitherPlan {
  /** "string or number": the two commonest types, as the menu entry names them. */
  label: string;
  /** What the row becomes: a `$in` with one chip per sampled type that can hold the value. */
  patch: { op: '$in'; valType: 'array'; value: string };
}

/**
 * The `$in` that matches `text` as every sampled type that can hold it
 * (`["75001", 75001]`), or null unless both of the two commonest types can,
 * each as a chip of its own: a number and a long match the same documents, so
 * they are not two sides.
 */
export function eitherPlan(split: readonly TypeShare[], text: string, from: ValType): EitherPlan | null {
  const [first, second] = split;
  if (!first || !second || text === '') return null;
  const chipOf = (type: string): Chip | null => (holds(text, from, type) ? chipFor(text, type) : null);
  const a = chipOf(first.type);
  const b = chipOf(second.type);
  if (a === null || b === null || a === b) return null;
  const chips: Chip[] = [];
  for (const { type } of split) {
    const chip = chipOf(type);
    if (chip !== null && !chips.includes(chip)) chips.push(chip);
  }
  return {
    label: `${first.type} or ${second.type}`,
    patch: { op: '$in', valType: 'array', value: valueFromChips(chips) },
  };
}

/** Whether a `$in` row's chips span two kinds that the sample holds: the row "Match either" makes. */
export function isEitherRow(chips: readonly Chip[], split: readonly TypeShare[]): boolean {
  const sampled = new Set(split.map((s) => (NUMBER_FAMILY.has(s.type) ? 'number' : s.type)));
  const kinds = new Set(chips.filter((c) => c !== null).map((c) => typeof c));
  return kinds.size >= 2 && [...kinds].every((k) => sampled.has(k));
}

/** "a number", "an objectid". */
function withArticle(type: string): string {
  return /^[aeiou]/.test(type) ? `an ${type}` : `a ${type}`;
}

export type MixedHint =
  /** The value matches only part of the sample. */
  | { kind: 'skips'; text: string }
  /** No other sampled type can hold the value, so only the sent type's part of the sample can match. */
  | { kind: 'only'; text: string };

/**
 * What the helper line says about a typed value in a mixed field, or null when
 * there is nothing to say (the sample is not mixed, or the value's own type is
 * not in it). `sent` is the sampled type name the row sends.
 */
export function mixedHint(
  field: string,
  split: readonly TypeShare[],
  sent: string,
  text: string,
  from: ValType,
): MixedHint | null {
  if (!isMixedSplit(split) || text === '') return null;
  if (!split.some((s) => sameFamily(s.type, sent))) return null;
  const others = split.filter((s) => !sameFamily(s.type, sent));
  const first = others[0];
  if (!first) return null;
  if (!others.some((o) => holds(text, from, o.type))) {
    return { kind: 'only', text: `Not ${withArticle(first.type)}, so only ${sent} values can match.` };
  }
  const skipped = others.reduce((sum, o) => sum + o.share, 0);
  const names = others.map((o) => withArticle(o.type)).join(' or ');
  return { kind: 'skips', text: `Skips the ${skipped}% that store ${field} as ${names}` };
}
