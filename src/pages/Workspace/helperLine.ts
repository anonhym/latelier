/**
 * The one line under a value box. Several things can want it at once (a
 * problem, an Undo notice, a type hint, a parsed preview); only the most urgent
 * is shown, so the box never grows a stack of notes.
 */
export type HelperKind = 'error' | 'undo' | 'hint' | 'info';

export interface HelperCandidate {
  kind: HelperKind;
  text: string;
}

/** Most urgent first. */
const RANK: Readonly<Record<HelperKind, number>> = { error: 0, undo: 1, hint: 2, info: 3 };

/**
 * The candidate to show: the lowest rank wins (error, then undo, then hint,
 * then info), and the first listed wins among equals. Null when there is none.
 */
export function pickHelperLine(candidates: readonly (HelperCandidate | null | undefined | false)[]): HelperCandidate | null {
  let best: HelperCandidate | null = null;
  for (const c of candidates) {
    if (!c) continue;
    if (best === null || RANK[c.kind] < RANK[best.kind]) best = c;
  }
  return best;
}
