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

/**
 * The canvas header (W06 §8.1): the view switch, the count and pager, References,
 * `⋯` and Insert. Nothing in it depends on the query: its steps are labels or
 * icons, and the pager with or without its First and Last buttons.
 */
export interface CanvasHeaderLayout {
  /** References and Insert as icons with tooltips. The view switch keeps its words. */
  iconControls: boolean;
  /** The pager's First and Last buttons. Previous, Next and the page size always stay. */
  pagerEnds: boolean;
}

// The header's fixed parts with words: view switch 150, `⋯` 26, Insert 70,
// pager 230, gaps and padding 60, and the count's 150 beside them. Past the
// pane's 320px minimum the labels cannot fit, so they step to icons earlier.
const HEADER_LABELS_MIN = 700;
// The same, with First and Last (2 x 26) in the pager.
const PAGER_ENDS_MIN = 520;
// The References control, measured with its gap, as a labelled button.
const REFERENCES_LABEL_WIDTH = 141;

/**
 * `withReferences` is a control, not the query: the workspace tab shows the
 * References button and previews do not, so the tab's step sits that much wider.
 */
export function canvasHeaderLayout(width: number | null, withReferences = false): CanvasHeaderLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  return {
    iconControls: (withReferences ? w - REFERENCES_LABEL_WIDTH : w) < HEADER_LABELS_MIN,
    pagerEnds: w >= PAGER_ENDS_MIN,
  };
}

/** The count's slot in the result bar (W01 §14.6): the width it gets is the count's own. */
export interface StatusCountLayout {
  /** The query-plan badge takes count room the narrowest bars do not have. */
  planBadge: boolean;
}

// The count ("6,382+ documents · 1234 ms", about 150 wide at the band's 11px
// text) has one form; the plan badge's 44px minimum beside it is what gives way.
const PLAN_BADGE_MIN = 200;

export function statusCountLayout(width: number | null): StatusCountLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  return { planBadge: w >= PLAN_BADGE_MIN };
}
