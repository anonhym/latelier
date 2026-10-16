import React from 'react';
import { getStructureEntries } from '../../features/fieldSuggestions/sources/sampleSchemaSource';
import type { SuggestionContext } from '../../features/fieldSuggestions/types';
import type { SchemaSampleEntry } from '@shared/types';

const EMPTY: ReadonlyMap<string, SchemaSampleEntry> = new Map();

/**
 * The collection's sampled type histogram, keyed by field path; empty until
 * it loads, and while `enabled` is false. Every caller shares one cached,
 * in-flight sample (`getStructureEntries`), so a row per condition costs one
 * round trip, not one each.
 */
export function useStructureEntries(
  ctx: SuggestionContext | null,
  enabled: boolean,
): ReadonlyMap<string, SchemaSampleEntry> {
  const [entries, setEntries] = React.useState<SchemaSampleEntry[] | null>(null);
  const connectionId = ctx?.connectionId;
  const dbName = ctx?.dbName;
  const collection = ctx?.collection;
  React.useEffect(() => {
    if (!enabled || !connectionId || !dbName || !collection) return;
    let live = true;
    void getStructureEntries(connectionId, dbName, collection).then((next) => {
      if (live) setEntries(next);
    });
    return () => {
      live = false;
    };
  }, [enabled, connectionId, dbName, collection]);
  return React.useMemo(
    () => (enabled && entries ? new Map(entries.map((e) => [e.path, e])) : EMPTY),
    [enabled, entries],
  );
}
