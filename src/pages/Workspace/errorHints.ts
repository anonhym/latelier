import { OPERATORS, type OperatorClass } from '../../features/fieldSuggestions/operators';

/**
 * The one hint line under a failed query (W06 §8.15), chosen by what failed.
 * The message itself is shown without its internal code; this adds what to do
 * about it when the app can tell.
 */

/** The classes a filter can hold: a stage or an accumulator is never what a find meant. */
const FILTER_CLASSES: ReadonlySet<OperatorClass> = new Set([
  'query',
  'logical',
  'element',
  'evaluation',
  'array',
  'geo',
]);
const KNOWN = new Set(OPERATORS.map((op) => op.name));
/** `$` and four letters: at or under this, only a single edit is read as a typo. */
const SHORT_NAME = 5;
const FILTER_OPERATORS = [...new Set(OPERATORS.filter((op) => FILTER_CLASSES.has(op.class)).map((op) => op.name))];

/** Levenshtein distance between two short names. */
export function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min(previous[j]! + 1, current[j - 1]! + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * The real filter operator closest to a mistyped one, or null. Within two
 * edits for a long name and one for a short one: two edits away from `$foo`
 * there is always some three-letter operator, and a wrong guess is worse than
 * none. An operator that exists is not a typo, whatever sits near it: `$gt` in
 * the wrong place must not be answered with `$gte`.
 */
export function nearestOperator(name: string): string | null {
  if (KNOWN.has(name)) return null;
  let best: string | null = null;
  let bestDistance = name.length > SHORT_NAME ? 3 : 2;
  for (const candidate of FILTER_OPERATORS) {
    const distance = editDistance(name, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** What to do about a failed query, or null when the message is all there is to say. */
export function errorHint(error: { code: string; message: string }): string | null {
  const { message } = error;
  if (/unknown (top level )?operator/i.test(message)) {
    const typed = /\$\w+/.exec(message)?.[0];
    const nearest = typed === undefined ? null : nearestOperator(typed);
    return nearest === null ? null : `Did you mean ${nearest}?`;
  }
  const lower = message.toLowerCase();
  if (lower.includes('econnrefused') || lower.includes('connection refused')) return 'The server is not reachable.';
  // The driver's socket timeout reads "connection 3 to host:27017 timed out".
  // `TIMEOUT` is server selection or maxTimeMS, which that setting does not move.
  if (error.code !== 'TIMEOUT' && lower.includes('timed out') && (lower.includes('socket') || lower.includes('connection'))) {
    return "Raise Socket timeout in the connection's Advanced tab.";
  }
  return null;
}
