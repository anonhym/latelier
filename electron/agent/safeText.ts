/**
 * Characters that must never reach one of main's own dialogs from a name:
 * every control, format (zero-width and bidi overrides), private-use,
 * unassigned and surrogate code point (`\p{C}`), plus the line and paragraph
 * separators. They let a name forge lines in the dialog or reorder what the
 * user reads around it.
 */
const UNSAFE = /[\p{C}\p{Zl}\p{Zp}]/u;
const UNSAFE_RUN = /[\p{C}\p{Zl}\p{Zp}]+/gu;

export function hasUnsafeChars(text: string): boolean {
  return UNSAFE.test(text);
}

/**
 * A name that came from outside main (the renderer, the database, a server's
 * role list), made safe to print in a dialog: each run of unsafe characters
 * becomes one space, and the result is trimmed.
 */
export function displayName(text: string, maxChars = 80): string {
  return text.replace(UNSAFE_RUN, ' ').trim().slice(0, maxChars);
}
