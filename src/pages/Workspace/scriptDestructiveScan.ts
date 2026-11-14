/**
 * W12 §8.4 — a courtesy scan of a script's source *as text* for the calls the
 * Documents view would make the user type a name to confirm: `deleteMany`
 * with an empty or missing filter, `.drop(` and `dropDatabase(`.
 *
 * It cannot see a filter built at run time or a call made through a variable,
 * and does not claim to; the Read-Only Connection handle is the enforcement.
 * Comments and string literals are blanked first, so the words inside them do
 * not count. The source is user-controlled: one pass to blank, then patterns
 * with no nested quantifiers.
 */

/** Settings' "Confirm destructive scripts" switch (an unset value means on). */
export const CONFIRM_DESTRUCTIVE_PREF_KEY = 'ui.scripts.confirmDestructive';

export type DestructiveCall = 'deleteMany({})' | 'drop()' | 'dropDatabase()';

/** `src` with every comment dropped and every string/template literal emptied. */
function blank(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out.push(' ');
    } else if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === '\\' ? 2 : 1;
      i++;
      out.push('""');
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
const DROP = /\.drop\s*\(/;
const DROP_DATABASE = /\bdropDatabase\s*\(/;

/** The destructive calls `source` appears to make, each once, in a fixed order. */
export function scanDestructive(source: string): DestructiveCall[] {
  const text = blank(source);
  const hits: DestructiveCall[] = [];
  if (DELETE_MANY_EMPTY.test(text)) hits.push('deleteMany({})');
  if (DROP.test(text)) hits.push('drop()');
  if (DROP_DATABASE.test(text)) hits.push('dropDatabase()');
  return hits;
}
