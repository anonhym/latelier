// What the Fields control's list shows (W14 §11.2): the rows, whether each is
// checked, the type it carries and how a locked row reads. Plain functions so
// the rules are testable without rendering the popover.

import { isRecord, toDisplayValue } from '../../utils/displayValue';
import { ejsonStringifyReadable } from '../../utils/ejson';
import { getAtSegments } from './documentDiff';
import { isExclusion, projectionMode, type ProjectionInfo } from './projection';
import { deriveColumns, orderFields } from './views/tableColumns';
import type { CollectionTabState } from '@shared/types';

/**
 * Every field known without asking the server, in the tab's column order: the
 * fields of the results in hand, the fields the projection names, the dotted
 * columns the tab keeps and the names its column order remembers.
 */
export function knownFields(
  documents: unknown[],
  projection: ProjectionInfo,
  computedPaths: readonly string[],
  order: readonly string[] | undefined,
): string[] {
  const names = [
    // `deriveColumns` lists `_id` even for no documents; before a first run
    // there is nothing to list, so the list says so.
    ...(documents.length > 0 ? deriveColumns(documents) : []),
    ...projection.entries.map(([k]) => k),
    ...computedPaths,
    ...(order ?? []),
  ];
  return orderFields([...new Set(names)], order ? [...order] : undefined);
}

/**
 * The known fields of a tab as it stands in `prev`, for a writer that runs
 * inside a `patchWith` and so reads the tab it is about to change.
 */
export function tabKnownFields(prev: CollectionTabState, documents: unknown[]): string[] {
  return knownFields(
    documents,
    projectionMode(prev.builder),
    (prev.columnConfig?.computed ?? []).map((c) => c.path),
    prev.columnConfig?.order,
  );
}

/**
 * A write can take a field out of what the results will hold (a Run after an
 * exclusion), and a row nothing names any more could never be ticked again. The
 * tab's column order is what remembers it (W14 §11.2), so every write that can
 * lose a row records the list as it stands: the patch that does so, or nothing
 * when the order already names every field.
 */
export function rememberedOrder(
  prev: CollectionTabState,
  known: readonly string[],
): Pick<CollectionTabState, 'columnConfig'> | Record<string, never> {
  const order = prev.columnConfig?.order ?? [];
  return known.every((f) => order.includes(f)) ? {} : { columnConfig: { ...prev.columnConfig, order: [...known] } };
}

/**
 * Whether the committed projection returns the field. Agrees with
 * `notFetchedFields`, which the views hide by, for a top-level name; it also
 * answers for a dotted path, which that one never lists.
 */
export function isFieldChecked(info: ProjectionInfo, field: string): boolean {
  if (info.mode === 'none' || info.mode === 'invalid') return true;
  const excluded = info.entries.filter(([, v]) => isExclusion(v)).map(([k]) => k);
  if (info.mode === 'exclusion') {
    return !excluded.some((k) => k === field || field.startsWith(`${k}.`));
  }
  if (field === '_id') return !excluded.includes('_id');
  return info.entries.some(
    ([k, v]) => !isExclusion(v) && (k === field || field.startsWith(`${k}.`) || k.startsWith(`${field}.`)),
  );
}

/** Whether any of the documents in hand holds the path (a dotted one included). */
export function documentsHold(documents: readonly unknown[], field: string): boolean {
  const path = field.split('.');
  return documents.some((d) => isRecord(d) && getAtSegments(d, path) !== null);
}

/** The type of the first value found for the field in the first 50 documents. */
export function fieldType(documents: readonly unknown[], field: string): string | null {
  const path = field.split('.');
  for (const d of documents.slice(0, 50)) {
    if (!isRecord(d)) continue;
    const found = getAtSegments(d, path);
    if (found !== null && found.value !== undefined) return toDisplayValue(found.value).type;
  }
  return null;
}

/** An operator row's value, as one short line: `$slice: 3`. */
export function operatorLabel(value: unknown): string {
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0].startsWith('$')) return `${keys[0]}: ${ejsonStringifyReadable(value[keys[0]])}`;
  }
  return ejsonStringifyReadable(value);
}

/** The top row's tag: how many fields the projection names, and whether the text holds more than the list can write. */
export function modeTag(info: ProjectionInfo): string {
  const custom = info.locked.length > 0 ? ' · custom' : '';
  const excluded = info.entries.filter(([, v]) => isExclusion(v)).length;
  switch (info.mode) {
    case 'inclusion':
      return `Including ${info.entries.length - excluded}${custom}`;
    case 'exclusion':
      return `Excluding ${excluded}${custom}`;
    case 'invalid':
      return "Can't read this projection";
    default:
      return `All fields${custom}`;
  }
}

/** A dotted path the find box may turn into a row: every segment named, no operator or space. */
export function isDottedPath(text: string): boolean {
  if (!text.includes('.')) return false;
  return text.split('.').every((seg) => seg.length > 0 && !seg.startsWith('$') && !/\s/.test(seg));
}
