/**
 * W12 §8.4 — a courtesy scan of a script's source *as text* for the calls the
 * Documents view would make the user type a name to confirm: `deleteMany`
 * with an empty or missing filter (also as a `bulkWrite` operation), `.drop(`,
 * `dropCollection(` and `dropDatabase(`.
 *
 * It cannot see a filter built at run time or a call made through a variable,
 * and does not claim to; the Read-Only Connection handle is the enforcement.
 * Comments, regular expressions and string literals are blanked first, so the
 * words inside them do not count; code inside a template's `${}` is scanned. The source is user-controlled: one pass to blank, then patterns
 * with no nested quantifiers.
 */

/** Settings' "Confirm destructive scripts" switch (an unset value means on). */
export const CONFIRM_DESTRUCTIVE_PREF_KEY = 'ui.scripts.confirmDestructive';

export type DestructiveCall =
  | 'deleteMany({})'
  | 'bulkWrite delete({})'
  | 'drop()'
  | 'dropCollection()'
  | 'dropDatabase()';

// After one of these a `/` starts a regular expression; after any other word,
// a number, `)` or `]` it is a division.
const REGEX_AFTER_WORD: ReadonlySet<string> = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await',
]);

const isWordChar = (c: string) => /[\w$]/.test(c);

/** Whether a `/` at `i` opens a regular expression, judged by what precedes it. */
function slashStartsRegex(src: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j]!)) j--;
  if (j < 0) return true;
  const p = src[j]!;
  if (isWordChar(p)) {
    let k = j;
    while (k > 0 && isWordChar(src[k - 1]!)) k--;
    return REGEX_AFTER_WORD.has(src.slice(k, j + 1));
  }
  // An operand just ended (a call, an index, a literal): division.
  return !(p === ')' || p === ']' || p === '"' || p === "'" || p === '`');
}

/**
 * `src` with every comment and regular expression dropped and every string
 * and template literal emptied, except what runs: the code inside a template's
 * `${}` stays, and a string that is an object key (`"deleteMany": {…}`) stays
 * as the bare key. One pass over the text with explicit state, so nesting
 * cannot recurse deeply.
 */
function blank(src: string): string {
  const out: string[] = [];
  // Open `${`s, each holding how many `{` are open inside it.
  const open: number[] = [];
  let inTemplate = false;
  // A `/` before this index found no closing `/` on its line, so the regex
  // scan is not repeated for every slash of the same line.
  let noRegexBefore = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (inTemplate) {
      if (c === '\\') i += 2;
      else if (c === '`') {
        inTemplate = false;
        out.push('""');
        i++;
      } else if (c === '$' && src[i + 1] === '{') {
        open.push(0);
        inTemplate = false;
        out.push(' ');
        i += 2;
      } else i++;
      continue;
    }
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out.push(' ');
    } else if (c === '/' && i >= noRegexBefore && slashStartsRegex(src, i)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n' && (src[j] !== '/' || inClass)) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      if (j < src.length && src[j] === '/') {
        j++;
        out.push('""');
        i = j;
      } else {
        noRegexBefore = j;
        out.push(c);
        i++;
      }
    } else if (c === '"' || c === "'") {
      const start = ++i;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      const content = src.slice(start, i);
      i++;
      let k = i;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k++;
      out.push(src[k] === ':' && /^[A-Za-z_$][\w$]*$/.test(content) ? content : '""');
    } else if (c === '`') {
      inTemplate = true;
      i++;
    } else if (c === '{' && open.length > 0) {
      open[open.length - 1] = open[open.length - 1]! + 1;
      out.push(c);
      i++;
    } else if (c === '}' && open.length > 0) {
      if (open[open.length - 1] === 0) {
        open.pop();
        inTemplate = true;
        out.push(' ');
      } else {
        open[open.length - 1] = open[open.length - 1]! - 1;
        out.push(c);
      }
      i++;
    } else {
      out.push(c);
      i++;
    }
  }
  return out.join('');
}

// `deleteMany(` then nothing, `{}` or `{ }`, then the end of the argument list
// or a second argument (options): the filter is empty or missing.
const DELETE_MANY_EMPTY = /\bdeleteMany\s*\(\s*(?:\{\s*\}\s*)?[,)]/;
// A bulkWrite operation `deleteMany: {}` / `deleteOne: { filter: {} … }`.
const BULK_DELETE_EMPTY = /\b(?:deleteMany|deleteOne)\s*:\s*\{\s*(?:filter\s*:\s*\{\s*\}\s*)?[,}]/;
const DROP = /\.drop\s*\(/;
const DROP_COLLECTION = /\bdropCollection\s*\(/;
const DROP_DATABASE = /\bdropDatabase\s*\(/;

/** The destructive calls `source` appears to make, each once, in a fixed order. */
export function scanDestructive(source: string): DestructiveCall[] {
  const text = blank(source);
  const hits: DestructiveCall[] = [];
  if (DELETE_MANY_EMPTY.test(text)) hits.push('deleteMany({})');
  if (BULK_DELETE_EMPTY.test(text)) hits.push('bulkWrite delete({})');
  if (DROP.test(text)) hits.push('drop()');
  if (DROP_COLLECTION.test(text)) hits.push('dropCollection()');
  if (DROP_DATABASE.test(text)) hits.push('dropDatabase()');
  return hits;
}
