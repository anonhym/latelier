import type { CollectionTabState } from '@shared/types';
import { ejsonParse } from '../../utils/ejson';
import { refusalMessage, refusalRange, repairToCanonicalEjson } from '../../utils/shellSyntax';
import {
  compileFindOptions,
  filterProblem,
  findOptionProblems,
  limitWarning,
  MAX_TIME_MS_CAP,
  maxTimeMSWarning,
  parseSortString,
  projectionProblem,
  sortProblem,
  type FindOptionKey,
} from './builder';
import { classifyProjection, projectionMode } from './projection';

/**
 * The Filter Bar row's words (W05 §9): what each option pill says, why Run is
 * refusing, and how long a run has taken. Pure, so the row, the strip under it
 * and the Run button read one answer.
 */

export type OptionKey = 'sort' | 'project' | 'limit' | 'skip' | FindOptionKey;
export type PillStatus = 'unset' | 'set' | 'invalid';

export interface OptionPill {
  key: OptionKey;
  /** The option's visible name, which also names its editor. */
  name: string;
  /** The name alone while unset, `Name: value` once set. */
  label: string;
  status: PillStatus;
}

/** Row order. The first three are always pills; the rest wait in `⋯ More` until set. */
export const OPTION_NAMES: Record<OptionKey, string> = {
  sort: 'Sort',
  project: 'Project',
  limit: 'Limit',
  skip: 'Skip',
  collation: 'Collation',
  hint: 'Hint',
  maxTimeMS: 'Max time',
  readPreference: 'Read preference',
};

const OPTION_KEYS = Object.keys(OPTION_NAMES) as OptionKey[];
const ALWAYS_PILLS: ReadonlySet<OptionKey> = new Set(['sort', 'project', 'limit']);
const HINT_LABEL_MAX = 24;

/** The text as the Shell Syntax transform would leave it (X14 §11). */
function liveText(text: string): string {
  const outcome = repairToCanonicalEjson(text);
  return outcome.kind === 'repaired' ? outcome.text : text;
}

/** The transform's own refusal first, then the clause's rule on the repaired text. */
function clauseProblem(text: string, strict: (repaired: string) => string | null): string | null {
  const outcome = repairToCanonicalEjson(text);
  return refusalMessage(text, outcome) ?? strict(outcome.kind === 'repaired' ? outcome.text : text);
}

function countLabel(n: number): string {
  return n === 1 ? '1 field' : `${n} fields`;
}

function sortValue(raw: string): string | null {
  // Only called once `sortProblem` has passed, so this parses to a document.
  const fields = Object.keys(ejsonParse<Record<string, unknown>>(raw));
  if (fields.length === 0) return null;
  const drawn = parseSortString(raw);
  // Two fields read at a glance; past that, or with a direction that has no
  // arrow (`$meta`), the count says more than a clipped list.
  if (fields.length > 2 || fields.some((f) => !Object.hasOwn(drawn, f))) return countLabel(fields.length);
  return fields.map((f) => `${f} ${drawn[f] === 1 ? '↑' : '↓'}`).join(', ');
}

function projectValue(builder: CollectionTabState['builder']): string | null {
  // Only called once `projectionProblem` has passed, so a raw one is a document.
  const { mode, entries } = projectionMode(builder);
  if (mode === 'exclusion') return `all but ${classifyProjection(entries).excluded.length}`;
  // A `$slice`-only trim returns every field, so it is not a field count.
  if (mode === 'none') return entries.length === 0 ? null : `all, ${entries.length} trimmed`;
  return countLabel(entries.length);
}

function collationValue(compiled: string): string {
  const { locale } = JSON.parse(compiled) as { locale?: unknown };
  return typeof locale === 'string' ? locale : 'set';
}

function clip(text: string): string {
  return text.length > HINT_LABEL_MAX ? `${text.slice(0, HINT_LABEL_MAX)}…` : text;
}

/** How a pill is drawn: a ghost label while unset, soft-filled once set, the error colour when it cannot run. */
export const PILL_LOOK: Record<PillStatus, { variant: 'subtle' | 'light'; color: string | undefined }> = {
  unset: { variant: 'subtle', color: 'gray' },
  set: { variant: 'light', color: undefined },
  invalid: { variant: 'light', color: 'red' },
};

type QueryText = Pick<CollectionTabState, 'queryRaw' | 'builder'>;

/** Every option's pill, in row order. */
export function optionPills(state: Pick<CollectionTabState, 'builder' | 'page' | 'pageSize'>): OptionPill[] {
  const { builder } = state;
  const compiled = compileFindOptions(builder);
  const optionProblems = findOptionProblems(builder);
  const skip = state.page * state.pageSize;

  // `undefined` is unset, `null` cannot run, a string is the value shown.
  const values: Record<OptionKey, string | null | undefined> = {
    sort: undefined,
    project: undefined,
    limit: undefined,
    skip: skip > 0 ? String(skip) : undefined,
    collation: undefined,
    hint: undefined,
    maxTimeMS: undefined,
    readPreference: undefined,
  };

  if (builder.sort.trim() !== '') {
    values.sort = clauseProblem(builder.sort, sortProblem) === null ? (sortValue(liveText(builder.sort)) ?? undefined) : null;
  }
  if (projectionProblem(builder) !== null) values.project = null;
  else values.project = projectValue(builder) ?? undefined;
  if (builder.limit.trim() !== '') {
    // A coerced limit still runs, as what this says (W15 §4.1).
    values.limit = compiled.limit === null ? 'none' : String(compiled.limit);
  }
  if (builder.collation?.trim()) {
    // A collation with no problem always compiles.
    values.collation = optionProblems.collation ? null : collationValue(compiled.collation!);
  }
  if (builder.hint?.trim()) {
    values.hint = optionProblems.hint ? null : clip(builder.hint.trim());
  }
  if (builder.maxTimeMS?.trim()) {
    values.maxTimeMS =
      compiled.maxTimeMS === undefined ? null : `${Math.min(compiled.maxTimeMS, MAX_TIME_MS_CAP)} ms`;
  }
  if (builder.readPreference) {
    values.readPreference = optionProblems.readPreference ? null : builder.readPreference;
  }

  return OPTION_KEYS.map((key) => {
    const name = OPTION_NAMES[key];
    const value = values[key];
    if (value === undefined) return { key, name, label: name, status: 'unset' };
    if (value === null) return { key, name, label: `${name}: invalid`, status: 'invalid' };
    return { key, name, label: `${name}: ${value}`, status: 'set' };
  });
}

/**
 * Which pills the row draws and which wait in `⋯ More`. A set option is
 * promoted out of the menu; so is the one whose editor is open, which would
 * otherwise have nothing to anchor to.
 */
export function splitPills(
  pills: readonly OptionPill[],
  open: OptionKey | null,
): { row: OptionPill[]; more: OptionPill[] } {
  const inRow = (p: OptionPill) => ALWAYS_PILLS.has(p.key) || p.status !== 'unset' || p.key === open;
  return { row: pills.filter(inRow), more: pills.filter((p) => !inRow(p)) };
}

export interface RunProblem {
  clause: 'filter' | OptionKey;
  message: string;
  /** Where in the filter text the parser points, when it does (W05 §9.3). */
  range?: { start: number; end: number };
}

/**
 * Why Run refuses this query, or null when it would run: the first problem in
 * clause order. Judged on the text as the transform would leave it, so valid
 * Shell Syntax that has not been committed yet is not a problem (X14 §11).
 */
export function runProblem(state: QueryText): RunProblem | null {
  const { builder } = state;
  const filter = clauseProblem(state.queryRaw, filterProblem);
  if (filter !== null) {
    const range = refusalRange(state.queryRaw, repairToCanonicalEjson(state.queryRaw));
    return range ? { clause: 'filter', message: filter, range } : { clause: 'filter', message: filter };
  }
  const sort = clauseProblem(builder.sort, sortProblem);
  if (sort !== null) return { clause: 'sort', message: sort };
  const projection = projectionProblem(builder);
  if (projection !== null) return { clause: 'project', message: projection };
  const options = findOptionProblems(builder);
  for (const key of ['collation', 'hint', 'maxTimeMS', 'readPreference'] as const) {
    const message = options[key];
    if (message !== undefined) return { clause: key, message };
  }
  return null;
}

/** A value that runs as something else than what was typed. It never closes the gate. */
export function runWarning(state: QueryText): RunProblem | null {
  const limit = limitWarning(state.builder.limit);
  if (limit !== null) return { clause: 'limit', message: limit };
  const maxTime = maxTimeMSWarning(state.builder.maxTimeMS);
  return maxTime === null ? null : { clause: 'maxTimeMS', message: maxTime };
}

/**
 * What `runProblem` and `runWarning` judged, as one string. A notice raised
 * for one query is shown only while this still matches, so an edit from
 * anywhere (the bar, the builder, a loaded query) retires it. Built from the
 * repaired text, so committing a repair does not retire the notice it raised.
 */
export function runProblemKey(state: QueryText): string {
  const b = state.builder;
  return JSON.stringify([
    liveText(state.queryRaw),
    liveText(b.sort),
    b.projection,
    b.projectionRaw,
    b.limit,
    b.collation,
    b.hint,
    b.maxTimeMS,
    b.readPreference,
  ]);
}

/** A clause as the thing to fix. The pill is named for the verb; what is wrong is the projection. */
function clauseNoun(clause: OptionKey): string {
  return clause === 'project' ? 'Projection' : OPTION_NAMES[clause];
}

/** The strip's sentence: the filter's own message, any other clause named first. */
export function stripText(problem: RunProblem): string {
  return problem.clause === 'filter' ? problem.message : `${clauseNoun(problem.clause)} — ${problem.message}`;
}

/** Run's label: the reason it is refusing, when it is. */
export function runLabel(problem: RunProblem | null): string {
  if (problem === null) return 'Run';
  return `Fix ${problem.clause === 'filter' ? 'filter' : clauseNoun(problem.clause).toLowerCase()} to run`;
}

/**
 * A run's elapsed time. Whole seconds while it ticks; `tenths` for a finished
 * figure ("Cancelled after 3.5 s"), where the fraction is the information.
 */
export function formatElapsed(ms: number, tenths = false): string {
  const seconds = ms / 1000;
  if (seconds >= 60) {
    const whole = Math.floor(seconds);
    return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  }
  return tenths ? `${seconds.toFixed(1)} s` : `${Math.floor(seconds)} s`;
}
