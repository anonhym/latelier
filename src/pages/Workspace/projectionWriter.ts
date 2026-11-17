// The Fields control's list writes the query projection (W14 §11): a pure
// writer from a checkbox click to the next builder, plus the rule that decides
// whether the rows on screen stay current once the projection changes. Lives
// beside `projection.ts` rather than in it because `resultQueryKey` comes from
// `builder.ts`, which already imports `projection.ts`.

import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';
import { ejsonStringify, ejsonStringifyReadable } from '../../utils/ejson';
import { ownSet } from '../../utils/ownProperty';
import { resultQueryKey } from './builder';
import {
  classifyProjection,
  isExclusion,
  isPlainKeep,
  isRawProjection,
  projectionMode,
  type ProjectionInfo,
} from './projection';
import type { BuilderState, CollectionTabState } from '@shared/types';

type Entry = [string, unknown];

function write(builder: BuilderState, entries: Entry[]): BuilderState {
  // The same state a blank projection commits (`useProjectionDraft`), so
  // clearing the list and clearing the text are one thing.
  if (entries.length === 0) return { ...builder, projection: [], projectionRaw: undefined };
  // A pure inclusion of plain 1s is the modelled path; everything else
  // (exclusions, operators, `_id: 0`) goes verbatim.
  if (entries.every(([, v]) => isPlainKeep(v))) {
    return { ...builder, projection: entries.map(([k]) => k), projectionRaw: undefined };
  }
  const doc: Record<string, unknown> = {};
  for (const [k, v] of entries) ownSet(doc, k, v);
  const text = ejsonStringifyReadable(doc);
  if (!isRawProjection(text)) {
    throw new Error(`Projection writer produced text the raw projection rule refuses: ${text}`);
  }
  return { ...builder, projection: [], projectionRaw: text };
}

function ordered(entries: Entry[], order: readonly string[]): Entry[] {
  const rank = (k: string) => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  // Array.prototype.sort is stable, so entries the list does not know keep
  // the place they had.
  return entries.slice().sort((a, b) => rank(a[0]) - rank(b[0]));
}

/**
 * One checkbox click in the Fields list, as the next builder (W14 §11.3).
 * `order` is the list's order, which the written fields follow. Returns the
 * builder untouched when the click has no meaning: an unreadable raw
 * projection (the list never overwrites what the user is typing), a locked
 * operator row, or a click that would leave an inclusion with nothing in it.
 */
export function toggleProjectionField(
  builder: BuilderState,
  field: string,
  checked: boolean,
  order: readonly string[],
): BuilderState {
  const info = projectionMode(builder);
  if (info.mode === 'invalid' || info.locked.includes(field)) return builder;
  let entries: Entry[] = info.entries.map(([k, v]): Entry => [k, v]);
  let at = entries.findIndex(([k]) => k === field);
  const current = at === -1 ? undefined : entries[at][1];
  // MongoDB refuses a projection naming a path and one of its ancestors
  // (`{a: 1, "a.b": 1}`), so a dotted path is never written beside its parent.
  const ancestorHolds = (flag: (v: unknown) => boolean) =>
    entries.some(([k, v]) => flag(v) && field.startsWith(`${k}.`));
  const dropDescendants = (flag: (v: unknown) => boolean) => {
    entries = entries.filter(([k, v]) => !(flag(v) && k.startsWith(`${field}.`)));
    at = entries.findIndex(([k]) => k === field);
  };
  const isKept = (v: unknown) => !isExclusion(v);

  if (info.mode === 'inclusion') {
    if (checked) {
      if (at === -1) {
        // The parent already brings this path: it is a column, not a projection entry.
        if (ancestorHolds(isKept)) return builder;
        // Checking the parent replaces the dotted children it now covers.
        dropDescendants(isKept);
        entries.push([field, 1]);
      } else if (isExclusion(current)) {
        // `_id: 0` inside an inclusion goes away; any other zero is junk the
        // inclusion never honoured, so it becomes the 1 it should be.
        if (field === '_id') entries.splice(at, 1);
        else entries[at] = [field, 1];
      }
    } else if (at === -1) {
      // Only `_id` is returned without being named.
      if (field === '_id') entries.push([field, 0]);
      else dropDescendants(isKept);
    } else if (field === '_id') {
      entries[at] = [field, 0];
    } else {
      entries.splice(at, 1);
      dropDescendants(isKept);
    }
    // What is left must still name a field to return: an inclusion that lost
    // its last field would read as "everything" (or, with `_id: 0` alone,
    // as everything but `_id`), the opposite of what was asked.
    const left = classifyProjection(entries);
    if (!left.inclusion) {
      if (left.excluded.includes('_id')) return builder;
      entries.push(['_id', 1]);
    }
  } else if (checked) {
    if (at !== -1 && isExclusion(current)) entries.splice(at, 1);
    // A `1` only ever rode along beside exclusions; with none left it would
    // turn the projection into an inclusion.
    if (!entries.some(([, v]) => isExclusion(v))) entries = entries.filter(([, v]) => !isPlainKeep(v));
  } else {
    // A parent already excluded takes its dotted children with it.
    if (ancestorHolds(isExclusion)) return builder;
    dropDescendants(isExclusion);
    if (at === -1) entries.push([field, 0]);
    else if (!isExclusion(current)) entries[at] = [field, 0];
  }
  // A click that changed nothing hands back the same builder, so the patch it
  // feeds is recognised as a no-op rather than rewriting the text.
  const same =
    entries.length === info.entries.length &&
    entries.every((e, i) => e[0] === info.entries[i][0] && e[1] === info.entries[i][1]);
  return same ? builder : write(builder, ordered(entries, order));
}

function keptKeys(info: ProjectionInfo): string[] {
  return info.entries.filter(([, v]) => !isExclusion(v)).map(([k]) => k);
}

function excludedKeys(info: ProjectionInfo): Set<string> {
  return new Set(info.entries.filter(([, v]) => isExclusion(v)).map(([k]) => k));
}

// The key itself and every dotted ancestor: `a.b.c` is covered by `a.b` and `a`.
function selfAndAncestors(key: string): string[] {
  const parts = key.split('.');
  return parts.map((_, i) => parts.slice(0, i + 1).join('.'));
}

function operatorSignature(info: ProjectionInfo): string {
  const pairs = info.entries
    .filter(([k]) => info.locked.includes(k))
    .map(([k, v]): [string, string] => [k, ejsonStringify(v)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify(pairs);
}

/**
 * True when the set of fields `next` fetches is a subset of what `prev`
 * fetches, so the rows already loaded still hold everything the new query
 * asks for (W14 §11.4). Conservative: a mode flip (`none` to an inclusion,
 * an exclusion back to `none`), an operator change or an unreadable
 * projection all answer false.
 */
export function onlyRemovesFields(prev: BuilderState, next: BuilderState): boolean {
  const a = projectionMode(prev);
  const b = projectionMode(next);
  if (a.mode === 'invalid' || b.mode === 'invalid') return false;
  if (operatorSignature(a) !== operatorSignature(b)) return false;
  if (a.mode === 'none') return b.mode === 'none' || b.mode === 'exclusion';
  if (a.mode === 'inclusion') {
    if (b.mode !== 'inclusion') return false;
    const kept = new Set(keptKeys(a));
    const nextKept = keptKeys(b);
    // `_id` comes back without being named unless it is excluded.
    const nextFetchesId = !excludedKeys(b).has('_id');
    const prevFetchesId = !excludedKeys(a).has('_id');
    return (
      nextKept.every((k) => selfAndAncestors(k).some((p) => kept.has(p))) &&
      (!nextFetchesId || prevFetchesId)
    );
  }
  if (b.mode !== 'exclusion') return false;
  const nextExcluded = excludedKeys(b);
  return [...excludedKeys(a)].every((k) => selfAndAncestors(k).some((p) => nextExcluded.has(p)));
}

/**
 * The tab patch for a new builder. The rows' query key moves with it only
 * when the rows were current and the change merely removes fields, so
 * unchecking a column does not raise the "not current" strip, while an
 * edited filter (rows already stale) stays stale.
 */
export function projectionPatch(
  prevState: CollectionTabState,
  nextBuilder: BuilderState,
): Partial<CollectionTabState> {
  const key = prevState.lastRunQueryKey;
  const current = key !== undefined && key === resultQueryKey(prevState);
  if (!current || !onlyRemovesFields(prevState.builder, nextBuilder)) return { builder: nextBuilder };
  return {
    builder: nextBuilder,
    // `resultQueryKey` is null for a filter that cannot run, but `current`
    // above means it could when the rows were fetched and the filter has not
    // moved since, so a null here is not reachable.
    lastRunQueryKey: resultQueryKey({ ...prevState, builder: nextBuilder }) ?? key,
  };
}

/**
 * W14 §11.6 — a tab saved with `columnConfig.hidden` becomes the projection
 * that hides the same fields, and the list is cleared. Idempotent, and returns
 * the same object when there is nothing to do. A hidden list beside a
 * projection the app cannot read is left alone: there is nowhere to write it,
 * and dropping it would lose the user's choice.
 */
export function migrateHiddenColumns(state: CollectionTabState): CollectionTabState {
  const hidden = state.columnConfig?.hidden;
  if (!hidden || hidden.length === 0) return state;
  if (projectionMode(state.builder).mode === 'invalid') return state;
  let builder = state.builder;
  for (const field of hidden) builder = toggleProjectionField(builder, field, false, hidden);
  const columnConfig = { ...state.columnConfig };
  delete columnConfig.hidden;
  return { ...state, ...projectionPatch(state, builder), columnConfig };
}

/**
 * The keys `migrateHiddenColumns` can change, for a caller that persists only
 * the difference. `lastRunQueryKey` is carried only when the tab had one.
 */
export function migrationPatch(migrated: CollectionTabState): Partial<CollectionTabState> {
  return {
    builder: migrated.builder,
    columnConfig: migrated.columnConfig,
    ...(migrated.lastRunQueryKey !== undefined ? { lastRunQueryKey: migrated.lastRunQueryKey } : {}),
  };
}

/**
 * `migrateHiddenColumns` for a seed that is only part of a tab's state (a
 * closed tab being reopened, a saved query's open): the missing parts read as
 * the defaults a new tab starts from. Returns the seed itself when there is
 * nothing to migrate.
 */
export function migrateHiddenSeed(seed: Partial<CollectionTabState>): Partial<CollectionTabState> {
  if (!seed.columnConfig?.hidden?.length) return seed;
  const full: CollectionTabState = { ...DEFAULT_COLLECTION_TAB_STATE, ...seed };
  const migrated = migrateHiddenColumns(full);
  return migrated === full ? seed : { ...seed, ...migrationPatch(migrated) };
}
