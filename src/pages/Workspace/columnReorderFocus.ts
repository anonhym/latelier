export type MoveDirection = 'up' | 'down';

/**
 * Which of a row's two Move buttons should hold focus after the field has
 * moved (#57).
 *
 * The button the user pressed is disabled the moment its field reaches an
 * end of the list — acceptance says the first row's "up" and the last row's
 * "down" are disabled rather than no-ops — and a disabled button cannot hold
 * focus, so the browser drops it to `<body>`. That is the defect #55 and #70
 * fixed on other surfaces. Focus therefore hands over to the row's other
 * button, which is always still enabled there.
 *
 * Pure and extracted rather than inlined in the layout effect, for the same
 * reason `useRovingHighlight` owns the clamp/wrap arithmetic (X19 §2): this
 * is a four-branch decision whose two halves are mirror images, and an
 * inverted branch typechecks, lints and renders perfectly. #56 shipped
 * exactly that failure — a keyboard resize running backwards against the
 * mouse on one edge — and it was caught by review, not by a green suite.
 *
 * There is deliberately no `direction` check on either end. Mutation testing
 * left both of them alive, and an exhaustive sweep of 162 inputs showed why:
 * a field moved up can only ever land at index 0, and one moved down only at
 * the last index, so `newIndex` already implies the direction. The guards
 * changed the answer for exactly one input — `('down', 0, 1)`, a
 * single-field list — where both buttons are disabled and `requestMove`
 * cannot run at all. They were dead code, and dead branches in a
 * mirror-image decision are where an inversion hides.
 */
export function focusTargetAfterMove(
  direction: MoveDirection,
  newIndex: number,
  length: number,
): MoveDirection {
  if (newIndex === 0) return 'down';
  if (newIndex === length - 1) return 'up';
  return direction;
}
