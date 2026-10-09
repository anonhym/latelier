import type { AggSaveCounts, AggSaveMode } from '@shared/types';

export interface SaveResultInfo extends AggSaveCounts {
  dbName: string;
  collection: string;
  mode: AggSaveMode;
}

/**
 * The toast shown after Save-as-collection. `$out` replaces the target, so the
 * total after the run is what was written. `$merge` keeps the target's existing
 * documents and updates matches in place, which no count can tell apart from
 * untouched ones: the message states only the target's size and how much it
 * grew.
 */
export function saveResultMessage(info: SaveResultInfo): string {
  const target = `${info.dbName}.${info.collection}`;
  if (info.mode === '$out') return `Wrote ${info.writtenCount ?? '?'} documents to ${target}`;
  const counts = info.mergeCounts;
  if (!counts) return `Merged into ${target}`;
  const added = counts.after - counts.before;
  // A concurrent delete can shrink the target mid-run; a negative "new" count
  // would be noise, so the growth is left out then.
  const growth = added >= 0 ? ` (+${added} new)` : '';
  return `Merged into ${target} — now ${counts.after} documents${growth}`;
}
