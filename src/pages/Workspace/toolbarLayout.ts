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

/**
 * The Filter Bar row (W05 §10): which controls give way as the results pane
 * narrows, in the order they do. The filter keeps its room first; the controls
 * collapse before it goes under `FILTER_MIN`. Width is the only input, on
 * purpose: a set pill, a run in flight or a refusing Run cannot reach here, so
 * no control changes form under the user's hand.
 */
export interface FilterBarLayout {
  /** Builder, Save and Queries as icons, their names in tooltips and accessible names. */
  queriesIcon: boolean;
  /** The pill group as one `Options` pill. */
  optionsFolded: boolean;
  /** Run without its shortcut hint, and no dividers. */
  runCompact: boolean;
  /** The filter takes a line to itself; the controls go on a second one. */
  wrap: boolean;
}

const FILTER_BAR_FORMS: FilterBarLayout[] = [
  { queriesIcon: false, optionsFolded: false, runCompact: false, wrap: false },
  { queriesIcon: true, optionsFolded: false, runCompact: false, wrap: false },
  { queriesIcon: true, optionsFolded: true, runCompact: false, wrap: false },
  { queriesIcon: true, optionsFolded: true, runCompact: true, wrap: false },
  { queriesIcon: true, optionsFolded: true, runCompact: true, wrap: true },
];

/** The field's room the controls collapse to keep. */
export const FILTER_MIN = 480;
/** Once every control has collapsed, the field's floor before the row wraps. */
export const FILTER_FLOOR = 320;

// The row's fixed parts, measured in the app at the theme's control sizes. Run
// is budgeted at its widest label ("Fix projection to run", with no shortcut
// hint, which only a runnable query shows) so it never moves; the page-reset
// icon is budgeted too, though it shows only after an edit on a later page.
const ROW_PADDING = 20; // 12 left, 8 right
const FILTER_LABEL = 27; // "Filter" and the gap before the field
const ROW_GAP = 8;
const OPTIONS_GROUP = 204; // Sort, Project, Limit and ⋯, unset
const OPTIONS_FOLDED = 90; // `Options` and its chevron
const BUILDER = 22;
const BUILDER_LABELLED = 86; // `⊽ Builder`, labelled while Save and Queries are
const SAVE_LABELLED = 162; // `☆ Save | Queries ▾`
const SAVE_ICONS = 62; // `☆ | ◷ ▾`
const RESET_ICON = 16;
const DIVIDER = 1;
const RUN_WIDEST = 189; // "Fix projection to run" and the menu chevron

function filterBarFixedWidth(form: FilterBarLayout): number {
  const tools = (form.queriesIcon ? BUILDER + SAVE_ICONS : BUILDER_LABELLED + SAVE_LABELLED) + ROW_GAP;
  const run = RESET_ICON + ROW_GAP + RUN_WIDEST;
  // The dividers are items of the row and of the tools, each with its gaps.
  const dividers = form.runCompact ? 0 : 2 * (DIVIDER + ROW_GAP);
  const groups = (form.optionsFolded ? OPTIONS_FOLDED : OPTIONS_GROUP) + tools + ROW_GAP + run;
  return ROW_PADDING + FILTER_LABEL + 2 * ROW_GAP + groups + dividers;
}

/**
 * The first one-line form whose fixed parts leave the filter `FILTER_MIN`.
 * When none does, the tightest one-line form holds while the filter keeps
 * `FILTER_FLOOR`, and the row wraps below that. Null width is not known
 * (jsdom): form 0.
 */
export function filterBarLayout(width: number | null): FilterBarLayout {
  const w = width ?? Number.POSITIVE_INFINITY;
  const oneLine = FILTER_BAR_FORMS.slice(0, -1);
  const fits = oneLine.find((f) => w - filterBarFixedWidth(f) >= FILTER_MIN);
  if (fits) return fits;
  const tightest = oneLine[oneLine.length - 1]!;
  return w - filterBarFixedWidth(tightest) >= FILTER_FLOOR ? tightest : FILTER_BAR_FORMS[FILTER_BAR_FORMS.length - 1]!;
}
