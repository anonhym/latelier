import React from 'react';
import { refusalMessage, repairOnCommit, repairToCanonicalEjson, type RepairOutcome } from '../../utils/shellSyntax';

/**
 * X18 §3 — the seam every Shell Syntax text surface routes its repair
 * through, instead of retyping "rewrite on blur, and again on the action
 * because a click can land before a blur ever fires" by hand.
 *
 * The repair itself stays in `shellSyntax.ts`; this hook only owns the
 * draft lifecycle around it — the refusal state, its clear-on-change, and
 * the ordering rule ("the transform's own refusal first, then a second
 * rule on the already-repaired text, never collapsed into one sentence").
 */
export function useShellSyntaxField(opts: {
  value: string;
  /** Where a repair is written back. Omit for a surface that commits
   *  something other than the repaired text (Format), or that decides its
   *  own commit target (projection). */
  commit?: (repaired: string) => void;
  /** A second rule applied to already-repaired text, after the transform's
   *  own refusal — e.g. `filterProblem`. Omit where the caller ORs the two
   *  itself at render (sort).
   *
   *  Named `thenCheck` rather than `then`: an options object carrying a `then`
   *  method is a thenable, so `await`ing or resolving one anywhere downstream
   *  would call it with `(resolve, reject)` instead of the repaired text. */
  thenCheck?: (repaired: string) => string | null;
}): {
  /** Live, recomputed each render from `value`. Serves the drawers' Save gate. */
  outcome: RepairOutcome;
  /** The refusal to render, or null. Cleared by `onChange`. */
  refusal: string | null;
  /**
   * The refusal derived from the uncommitted `value`, every render, with no
   * state behind it. For the drawers, whose `Notice` tracks the buffer as it
   * is typed rather than waiting for a commit — the same asymmetry that has
   * them gate Save off a live `outcome`.
   *
   * A surface picks one of these, never both. `refusal` is for a commit-point
   * message (`role="alert"`, so announcing half-typed input would be wrong);
   * `liveRefusal` is for a surface that always showed one per keystroke.
   */
  liveRefusal: string | null;
  onChange: (next: string) => void;
  /** Repair, commit, set the refusal. */
  onBlur: () => void;
  /** Repair + commit + hand back the text to act on this tick — a state
   *  patch is async, so a Run/Save pressed before any blur can't wait for it. */
  commitNow: () => { text: string; outcome: RepairOutcome };
  /** Repair and set the refusal, but commit nothing. */
  repairNow: () => { text: string; outcome: RepairOutcome };
} {
  const { value, commit, thenCheck } = opts;

  // Memoized on `value`, not recomputed per render: the drawers need this
  // live off the uncommitted buffer, but QueryBar mounts three of these and
  // re-renders on every keystroke in any one of them. `repairToCanonicalEjson`
  // is pure, so keying on `value` is the same answer for less parsing.
  const outcome = React.useMemo(() => repairToCanonicalEjson(value), [value]);
  const [refusal, setRefusal] = React.useState<string | null>(null);

  // The new text itself carries no information this hook needs — the next
  // `outcome` is already live off `value` — so `onChange` exists only to
  // drop the previous commit's stale refusal.
  const onChange: (next: string) => void = () => setRefusal(null);

  // Shared by onBlur/commitNow/repairNow. `doCommit` is the only difference
  // between "commit" and "repair-only" — everything else, including which
  // refusal wins, is identical.
  const settle = (doCommit: boolean): { text: string; outcome: RepairOutcome } => {
    const result = repairOnCommit(value, doCommit ? (commit ?? (() => {})) : () => {});
    setRefusal(refusalMessage(value, result.outcome) ?? (thenCheck ? thenCheck(result.text) : null));
    return result;
  };

  const onBlur = () => {
    settle(true);
  };
  const commitNow = () => settle(true);
  const repairNow = () => settle(false);

  const liveRefusal = React.useMemo(() => refusalMessage(value, outcome), [value, outcome]);

  return { outcome, refusal, liveRefusal, onChange, onBlur, commitNow, repairNow };
}
