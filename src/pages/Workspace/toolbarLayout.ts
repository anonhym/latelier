/**
 * Which form each results toolbar takes at a given width. These functions take
 * the bar's width and nothing else on purpose: a stale query, a run in flight or
 * results arriving cannot change a control's form, because they cannot reach here.
 *
 * Null means the width is not known (no layout, as in jsdom): room for everything.
 *
 * The numbers are the widest each bar's fixed parts can be at each step, at the
 * theme's control sizes. Whatever is left over goes to the count, which
 * truncates before any control moves.
 */

export type CountForm = 'full' | 'range' | 'total';

/**
 * The canvas header (W06 §8.1): the view switch, Fields, References, `⋯` and
 * Insert. Nothing in it depends on the query, so labels or icons is its only step.
 */
export interface CanvasHeaderLayout {
  /** Fields, References and Insert as icons with tooltips. The view switch keeps its words. */
  iconControls: boolean;
}

// The header's fixed parts with words: view switch 150, Fields 80, `⋯` 26,
// Insert 70, gaps and padding 60. The icon form fits the result pane's 320px minimum.
const HEADER_LABELS_MIN = 400;
// The References control, measured with its gap, as a labelled button.
const REFERENCES_LABEL_WIDTH = 141;

/**
 * `withReferences` is a control, not the query: the workspace tab shows the
 * References button and previews do not, so the tab's step sits that much wider.
 */
export function canvasHeaderLayout(width: number | null, withReferences = false): CanvasHeaderLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  return { iconControls: (withReferences ? w - REFERENCES_LABEL_WIDTH : w) < HEADER_LABELS_MIN };
}

/** The status bar's middle part (W01 §14.6): the width it gets is the count's own. */
export interface StatusCountLayout {
  /** full: "60 results · 2 ms · showing 1–50". range: "1–50 of 60". total: "60 results". */
  count: CountForm;
  /** The query-plan badge takes count room the narrowest bars do not have. */
  planBadge: boolean;
}

// Widest each form gets at the band's 11px text, plus the plan badge's 44px
// minimum beside it: "6,382+ results · 1234 ms · showing 6,351–6,382" is about 260.
const COUNT_FULL_MIN = 320;
const COUNT_RANGE_MIN = 160;
const PLAN_BADGE_MIN = 200;

export function statusCountLayout(width: number | null): StatusCountLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  let count: CountForm = 'total';
  if (w >= COUNT_FULL_MIN) count = 'full';
  else if (w >= COUNT_RANGE_MIN) count = 'range';
  return { count, planBadge: w >= PLAN_BADGE_MIN };
}
