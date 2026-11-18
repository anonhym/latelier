// The `$regex` option letters a condition row offers, and how a toggle changes
// them. Pure; the row's value editor draws the buttons.
import { isRegexOptions, normalizeRegexOptions } from './filterTree';

export const REGEX_OPTIONS = [
  { letter: 'i', label: 'Ignore case' },
  { letter: 'm', label: 'Multiline: ^ and $ match at each line' },
  { letter: 's', label: 'Dot also matches a newline' },
  { letter: 'x', label: 'Ignore whitespace and # comments in the pattern' },
] as const;

/** `options` with `letter` turned on or off, in `imsx` order; '' when none is left. */
export function toggleRegexOption(options: string, letter: string): string {
  const next = options.includes(letter) ? [...options].filter((c) => c !== letter).join('') : options + letter;
  return normalizeRegexOptions(next);
}

/** The helper line for lit options ("Ignore case, multiline"), or null when none is. */
export function regexOptionsText(options: string): string | null {
  if (options === '' || !isRegexOptions(options)) return null;
  const names: Record<string, string> = {
    i: 'ignore case',
    m: 'match each line',
    s: 'dot matches newline',
    x: 'ignore whitespace',
  };
  const text = [...options].map((c) => names[c]).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
