// The Fields control's list writes the query projection (W14 §11): a pure
// writer from a checkbox click to the next builder, plus the rule that decides
// whether the rows on screen stay current once the projection changes. Lives
// beside `projection.ts` rather than in it because `resultQueryKey` comes from
// `builder.ts`, which already imports `projection.ts`.

import { DEFAULT_COLLECTION_TAB_STATE } from '@shared/defaults';
import { ejsonStringify, ejsonStringifyReadable } from '../../utils/ejson';
import { ownSet } from '../../utils/ownProperty';
import { resultQueryKey } from './builder';
import { knownFields, rememberedOrder } from './fieldsList';
import {
  classifyProjection,
  isExclusion,
  isPlainKeep,
  isRawProjection,
  projectionHider,
  projectionMode,
  selfAndAncestors,
  type ProjectionInfo,
} from './projection';
import type { BuilderState, CollectionTabState } from '@shared/types';

type Entry = [string, unknown];

function write(builder: BuilderState, entries: Entry[]): BuilderState {
  // The same state a blank projection commits (`useProjectionDraft`), so
  // clearing the list and clearing the text are one thing.
  // Stryker disable next-line ConditionalExpression: with no entries the `every` below is true and its branch returns this same object, so skipping this line changes nothing (confirmed by forcing it to false: the whole unit suite still passes)
  if (entries.length === 0) return { ...builder, projection: [], projectionRaw: undefined };
  // A pure inclusion of plain 1s is the modelled path; everything else
  // (exclusions, operators, `_id: 0`) goes verbatim.
  if (entries.every(([, v]) => isPlainKeep(v))) {
    return { ...builder, projection: entries.map(([k]) => k), projectionRaw: undefined };
  }
  const doc: Record<string, unknown> = {};
  for (const [k, v] of entries) ownSet(doc, k, v);
  const text = ejsonStringifyReadable(doc);
  // Stryker disable next-line ConditionalExpression,BlockStatement: a guard that cannot fire. Keys are written as quoted JSON strings and values come from an already parsed projection or are 0/1, and a probe of fourteen awkward keys (spaces, quotes, `$`, `__proto__`, newlines, empty) all produced text the rule accepts
  if (!isRawProjection(text)) {
    // Stryker disable next-line StringLiteral,CallExpression: the throw of the same unreachable guard
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
  // Stryker disable next-line MethodExpression: `entries` is the caller's own local array and nothing reads it after this sort, so sorting it in place gives the same result
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
  // An operator row is edited in the text only. A parent or child of one
  // would collide with it (`{a: 0, "a.b": {$slice: 2}}` is refused by
  // MongoDB), and dropping the operator would discard what the user typed.
  if (info.locked.some((k) => k.startsWith(`${field}.`) || field.startsWith(`${k}.`))) return builder;
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
    // `current` is undefined when the field is not in the list, and that is not an exclusion.
    if (isExclusion(current)) entries.splice(at, 1);
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
  if (a.mode === 'invalid') return false;
  // Stryker disable next-line ConditionalExpression,StringLiteral: an unreadable `b` reads as no entries and no operators, and every branch below answers false for it: `none` needs b to be `none` or an exclusion, an inclusion needs an inclusion, an exclusion needs an exclusion (and an operator in `a` already differs from its empty signature)
  if (b.mode === 'invalid') return false;
  if (operatorSignature(a) !== operatorSignature(b)) return false;
  // The views hide whole top-level fields only, so a change keeps the rows on
  // screen correct only when everything it newly drops is a top-level field:
  // a dotted exclusion (`address.city: 0`) or a narrowed dotted inclusion
  // still leaves that value drawn, and the rows must read as not current.
  const topLevel = (k: string) => !k.includes('.');
  if (a.mode === 'none') {
    if (b.mode === 'none') return true;
    return b.mode === 'exclusion' && [...excludedKeys(b)].every(topLevel);
  }
  if (a.mode === 'inclusion') {
    if (b.mode !== 'inclusion') return false;
    const kept = new Set(keptKeys(a));
    const nextKept = new Set(keptKeys(b));
    // `_id` comes back without being named unless it is excluded.
    const nextFetchesId = !excludedKeys(b).has('_id');
    const prevFetchesId = !excludedKeys(a).has('_id');
    return (
      // The old query fetched `_id` without naming it, so naming it fetches nothing new.
      [...nextKept].every((k) => kept.has(k) || (k === '_id' && prevFetchesId)) &&
      [...kept].filter((k) => !nextKept.has(k)).every(topLevel) &&
      (!nextFetchesId || prevFetchesId)
    );
  }
  if (b.mode !== 'exclusion') return false;
  const prevExcluded = excludedKeys(a);
  const nextExcluded = excludedKeys(b);
  return (
    [...prevExcluded].every((k) => selfAndAncestors(k).some((p) => nextExcluded.has(p))) &&
    [...nextExcluded].filter((k) => !prevExcluded.has(k)).every(topLevel)
  );
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
  // `resultQueryKey` answers a string or null, never undefined, so a tab with no
  // key yet is never equal to it.
  const current = key === resultQueryKey(prevState);
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
  const info = projectionMode(state.builder);
  if (info.mode === 'invalid') return state;
  let builder = state.builder;
  for (const field of hidden) builder = toggleProjectionField(withoutOperatorsOn(builder, field), field, false, hidden);
  // A field the projection still returns after all that could not be written
  // into it; keeping it listed keeps the user's choice rather than showing a
  // field they hid.
  const hide = projectionHider(builder);
  const unmigrated = hidden.filter((f) => !hide?.(f));
  // Result documents are not kept, so a field the migration takes out of an
  // inclusion would have no row left in the Fields list to tick it back. The
  // order remembers it, as the checkbox writers do. An exclusion keeps the
  // names it drops, so it needs nothing.
  const remembered =
    info.mode === 'inclusion' && builder !== state.builder
      ? // Stryker disable next-line OptionalChaining: `hidden` came from `state.columnConfig?.hidden` and is not empty, so `columnConfig` is defined here and the plain access reads the same
        rememberedOrder(
          state,
          knownFields(
            [],
            info,
            // Stryker disable next-line OptionalChaining: same reason, `columnConfig` is defined
            [...(state.columnConfig?.computed ?? []).map((c) => c.path), ...hidden],
            // Stryker disable next-line OptionalChaining: same reason, `columnConfig` is defined
            state.columnConfig?.order,
          ),
        )
      : {};
  const columnConfig = { ...state.columnConfig, ...remembered.columnConfig };
  delete columnConfig.hidden;
  if (unmigrated.length > 0) {
    if (builder === state.builder) return state;
    columnConfig.hidden = unmigrated;
  }
  return { ...state, ...projectionPatch(state, builder), columnConfig };
}

/**
 * The builder without any operator on `field` or a path inside it. A hidden
 * field is not shown at all, so a `$slice` or `$elemMatch` on it shapes
 * nothing anyone sees, and the list refuses to write beside one.
 */
function withoutOperatorsOn(builder: BuilderState, field: string): BuilderState {
  const info = projectionMode(builder);
  const moot = (k: string) => info.locked.includes(k) && (k === field || k.startsWith(`${field}.`));
  if (!info.entries.some(([k]) => moot(k))) return builder;
  const left = info.entries.filter(([k]) => !moot(k));
  // An inclusion that loses its last named field would read as "everything";
  // `_id` alone keeps it returning no more than it did.
  if (info.mode === 'inclusion' && !classifyProjection(left).inclusion) {
    // With `_id: 0` too there is nothing left to return: keep the projection,
    // and the caller keeps the field in its hidden list.
    if (left.some(([k]) => k === '_id')) return builder;
    left.push(['_id', 1]);
  }
  return write(builder, left);
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
  // Stryker disable next-line ConditionalExpression: with nothing hidden `migrateHiddenColumns` hands back `full` itself, which the line below turns into `seed`, so skipping this early return gives the same object
  if (!seed.columnConfig?.hidden?.length) return seed;
  const full: CollectionTabState = { ...DEFAULT_COLLECTION_TAB_STATE, ...seed };
  const migrated = migrateHiddenColumns(full);
  return migrated === full ? seed : { ...seed, ...migrationPatch(migrated) };
}
