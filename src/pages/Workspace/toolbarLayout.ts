/**
 * Which form each results toolbar takes at a given width. These functions take
 * the bar's width and the few things that size a control (whether References is
 * there, the total's length) and nothing else on purpose: a stale query, a run
 * in flight or results arriving cannot change a control's form, because they
 * cannot reach here.
 *
 * Null means the width is not known (no layout, as in jsdom): room for everything.
 *
 * The numbers are measured in the app at the theme's control sizes. Whatever is
 * left over goes to the count, which truncates before any control moves.
 */

/**
 * The total as the count and the pager label write it: `6,382`, or `6,382+`
 * while the find has more and no count has come back. An uncounted total is
 * only a lower bound, so the caller passes the end of the range shown, not the
 * page's own document count.
 */
export function totalLabelText(totalCount: number | undefined, rangeEnd: number, hasMore: boolean): string {
  return `${(totalCount ?? rangeEnd).toLocaleString()}${hasMore && totalCount === undefined ? '+' : ''}`;
}

const DIGIT = 7.8; // a figure
const SEPARATOR = 3.4; // a thousands separator
const DASH_AND_OF = 18; // the en dash and " of "
const ICON = 22; // an ActionIcon, and every pager button
const MORE = 22;
const INSERT_LABEL = 78;
const REFERENCES_LABEL = 134;
const SWITCH_LABELS = 150;
const SWITCH_ICONS = 90;
const PAGE_SIZE = 56; // the select and its margin
const PADDING = 28;

/**
 * Room the widest page label ("123,451–123,456 of 123,456") takes for this
 * total. Anything that is not a figure or a `+` counts as a separator, so a
 * locale with a narrow-space separator measures the same.
 */
export function pageLabelWidth(total: string): number {
  const figures = [...total].filter((c) => /[\d+]/.test(c)).length;
  return Math.ceil(3 * figures * DIGIT + 3 * (total.length - figures) * SEPARATOR + DASH_AND_OF);
}

/**
 * The canvas header (W06 §8.1): the view switch, the count and pager, References,
 * `⋯` and Insert. Its steps, in the order they are taken as the bar narrows:
 * References and Insert as icons, no First and Last, no page size, the view
 * switch as icons, and last the page label's reserved width.
 */
export interface CanvasHeaderLayout {
  /** References and Insert as icons with tooltips. */
  iconControls: boolean;
  /** The pager's First and Last buttons. */
  pagerEnds: boolean;
  /** The rows-per-page select. Previous and Next always stay. */
  pageSize: boolean;
  /** The view switch as three icons (each keeps its name for assistive tech). */
  compactViews: boolean;
  /** The page label keeps the room its widest text needs, so Next holds still. */
  labelReserve: boolean;
}

const FORMS: CanvasHeaderLayout[] = [
  { iconControls: false, pagerEnds: true, pageSize: true, compactViews: false, labelReserve: true },
  { iconControls: true, pagerEnds: true, pageSize: true, compactViews: false, labelReserve: true },
  { iconControls: true, pagerEnds: false, pageSize: true, compactViews: false, labelReserve: true },
  { iconControls: true, pagerEnds: false, pageSize: false, compactViews: false, labelReserve: true },
  { iconControls: true, pagerEnds: false, pageSize: false, compactViews: true, labelReserve: true },
  { iconControls: true, pagerEnds: false, pageSize: false, compactViews: true, labelReserve: false },
];

// What the count keeps beside a form: the whole "123,456 documents · 1234 ms"
// beside the widest form, and a truncated figure beside the rest.
const COUNT_FULL = 150;
const COUNT_MIN = 80;

/** The widest the bar's fixed parts get in `form`, gaps and padding included. */
function fixedWidth(form: CanvasHeaderLayout, withReferences: boolean, labelWidth: number): number {
  const gap = form.iconControls ? 6 : 8;
  const items = withReferences ? 3 : 2;
  const references = withReferences ? (form.iconControls ? ICON : REFERENCES_LABEL) : 0;
  const right = references + MORE + (form.iconControls ? ICON : INSERT_LABEL) + (items - 1) * gap;
  const pager =
    2 * ICON + (form.pagerEnds ? 2 * ICON : 0) + (form.pageSize ? PAGE_SIZE : 0) + (form.labelReserve ? labelWidth : 0);
  return PADDING + (form.compactViews ? SWITCH_ICONS : SWITCH_LABELS) + 3 * gap + right + pager;
}

/**
 * The first form whose fixed parts leave the count its room; the last form
 * when none does. `withReferences` is a control, not the query: the workspace
 * tab shows the References button and previews do not.
 */
export function canvasHeaderLayout(width: number | null, withReferences = false, total = ''): CanvasHeaderLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  const label = pageLabelWidth(total);
  const fits = FORMS.find((f, i) => w - fixedWidth(f, withReferences, label) >= (i === 0 ? COUNT_FULL : COUNT_MIN));
  return fits ?? FORMS[FORMS.length - 1]!;
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
