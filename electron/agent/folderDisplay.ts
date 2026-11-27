/**
 * The folder a bridge reports as its working directory (X27 §16.3), cleaned
 * before it is stored and shortened before the renderer sees it. Display-only:
 * anything running as the user can start a bridge in any folder, so no
 * decision reads it.
 */

/** The longest folder main keeps, in UTF-16 code units. */
export const MAX_FOLDER_CHARS = 1024;

// Control (Cc) and format (Cf: bidi overrides and isolates, zero-width characters) code points, and the
// line and paragraph separators. Each could forge a line in a label or reorder what the user reads around
// it; none belongs in a path anyone typed.
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** Control, format and line-breaking characters stripped, then cut to 1,024 characters without splitting a surrogate pair. */
export function cleanFolder(raw: string): string {
  const stripped = raw.replace(UNSAFE_CHARS, '');
  // NaN on a shorter string, which then slices whole.
  const last = stripped.charCodeAt(MAX_FOLDER_CHARS - 1);
  // A high surrogate in the last kept slot would be half a character.
  const end = last >= 0xd800 && last <= 0xdbff ? MAX_FOLDER_CHARS - 1 : MAX_FOLDER_CHARS;
  return stripped.slice(0, end);
}

function isSeparator(ch: string | undefined, windows: boolean): boolean {
  return ch === '/' || (windows && ch === '\\');
}

/**
 * The form the renderer is sent: the home directory replaced by `~`, so the
 * OS user name never reaches it. Only a whole leading path segment matches:
 * `/Users/anna` is not inside `/Users/ann`. Windows compares without case and
 * takes either separator, as its paths do. A folder outside home is unchanged.
 */
export function displayFolder(clean: string, home: string, platform: NodeJS.Platform): string {
  const windows = platform === 'win32';
  let base = home;
  while (isSeparator(base.at(-1), windows)) base = base.slice(0, -1);
  // Unknown, or the root itself: nothing to shorten.
  if (base === '') return clean;
  const head = clean.slice(0, base.length);
  const same = windows ? head.toLowerCase() === base.toLowerCase() : head === base;
  if (!same) return clean;
  if (clean.length === base.length) return '~';
  if (!isSeparator(clean[base.length], windows)) return clean;
  return `~${clean.slice(base.length)}`;
}
