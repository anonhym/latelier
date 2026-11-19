/**
 * Values in copied text that are unlikely to repeat across servers: an
 * ObjectId, a UUID, a string of 6 characters or more, a number of 6 digits or
 * more. A boolean, `null` or a short string or number is never one, so a
 * paste of `true` or `3` can't be mistaken for a value from another server.
 *
 * Linear-time only: the quoted-string scan is a hand-written loop and every
 * pattern is a bounded class with no nested quantifier.
 */

/** How much of the copied text is scanned. */
export const MAX_SCAN_CHARS = 256 * 1024;
/** How many distinctive values are kept. */
export const MAX_DISTINCTIVE_VALUES = 1000;
/** The shortest string, or the fewest digits in a number, that counts. */
export const MIN_DISTINCTIVE_LENGTH = 6;

const OBJECT_ID = /(?<![0-9a-fA-F])[0-9a-fA-F]{24}(?![0-9a-fA-F])/g;
const UUID = /(?<![0-9a-fA-F])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![0-9a-fA-F])/g;
const NUMBER = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.])/g;
const HEX_ID_SHAPE = /^(?:[0-9a-fA-F]{24}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
const CALL_FORM = /^\w+\(/;
const NUMERIC_ONLY = /^-?\d+(?:\.\d+)?$/;

/** Hex ids compare without regard to case, so they are kept lower-cased. */
function normalise(value: string): string {
  return HEX_ID_SHAPE.test(value) ? value.toLowerCase() : value;
}

/** Whether the first character after `from`, blanks aside, is a colon: the literal before it is a key. */
function isFollowedByColon(text: string, from: number): boolean {
  let k = from;
  while (text[k] === ' ' || text[k] === '\t') k += 1;
  return text[k] === ':';
}

/**
 * The contents of each `"…"` or `'…'` literal that is a value, not an object
 * key (a field name says nothing about which server it was copied on),
 * escapes left as written. A
 * quote with no partner on its line is skipped together with the rest of that
 * line, so one pass covers the text however many stray quotes it holds.
 */
function quotedStrings(text: string): string[] {
  const found: string[] = [];
  let i = 0;
  // Stryker disable next-line EqualityOperator: at the end `text[i]` is undefined, no quote, so one more step changes nothing
  while (i < text.length) {
    const quote = text[i];
    if (quote !== '"' && quote !== "'") {
      i += 1;
      continue;
    }
    let j = i + 1;
    // Stryker disable next-line EqualityOperator: past the end `text[j]` is undefined, so the loop ends on the next test either way
    while (j < text.length && text[j] !== quote && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
    if (text[j] === quote && !isFollowedByColon(text, j + 1)) found.push(text.slice(i + 1, j));
    i = j + 1;
  }
  return found;
}

function digitCount(numeric: string): number {
  return numeric.replace(/\D/g, '').length;
}

/**
 * The distinctive values of `text`, in the order they first appear, without
 * repeats. Hex ids are lower-cased. Scans at most `MAX_SCAN_CHARS` characters
 * and returns at most `MAX_DISTINCTIVE_VALUES` values.
 */
export function distinctiveValues(text: string): string[] {
  const scanned = text.slice(0, MAX_SCAN_CHARS);
  const found = new Set<string>();
  const add = (value: string): void => {
    if (found.size < MAX_DISTINCTIVE_VALUES) found.add(normalise(value));
  };

  for (const m of scanned.matchAll(UUID)) add(m[0]);
  for (const m of scanned.matchAll(OBJECT_ID)) add(m[0]);
  // The digits between a UUID's dashes are no number of their own. An
  // ObjectId needs no such care: a hex run's boundary rule keeps its digits
  // from standing as a number unless the whole id is digits, which is itself.
  // Stryker disable next-line StringLiteral: the id can't touch a digit, so a blank and nothing read the same
  const withoutUuids = scanned.replace(UUID, ' ');
  for (const s of quotedStrings(scanned)) {
    if (s.length >= MIN_DISTINCTIVE_LENGTH) add(s);
  }
  for (const m of withoutUuids.matchAll(NUMBER)) {
    if (digitCount(m[0]) >= MIN_DISTINCTIVE_LENGTH) add(m[0]);
  }

  // A bare string, as the Value copy writes one: nothing else found in it, one
  // line, not a document, an array, a call such as `ObjectId(…)`, or a literal word.
  const bare = scanned.trim();
  if (
    found.size === 0 &&
    bare.length >= MIN_DISTINCTIVE_LENGTH &&
    !bare.includes('\n') &&
    !/^[{["']/.test(bare) &&
    !CALL_FORM.test(bare) &&
    bare !== 'undefined' &&
    !HEX_ID_SHAPE.test(bare) &&
    !NUMERIC_ONLY.test(bare)
  ) {
    add(bare);
  }
  return [...found];
}

/** True when `pasted` contains `value`, hex ids and UUIDs without regard to case. */
export function containsDistinctive(pasted: string, value: string): boolean {
  if (HEX_ID_SHAPE.test(value)) return pasted.toLowerCase().includes(value);
  return pasted.includes(value);
}

/** True when `text` is exactly `value`, hex ids and UUIDs without regard to case. */
export function matchesDistinctive(text: string, value: string): boolean {
  if (HEX_ID_SHAPE.test(value)) return text.toLowerCase() === value;
  return text === value;
}
