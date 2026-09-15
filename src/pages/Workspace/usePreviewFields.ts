import React from 'react';
import { api } from '../../api/atelier';

/**
 * Loads the user's chosen preview-field set for a given collection from
 * `prefs:getPreviewFields` and persists changes through the matching setter.
 * Returns `null` until the first load completes (TreeView falls back to a
 * generic preview in that window).
 */
export function usePreviewFields(
  connectionId: string | null,
  dbName: string | null,
  collection: string | null,
): [string[] | null, (fields: string[]) => void] {
  const cacheKey =
    connectionId && dbName && collection ? `${connectionId}::${dbName}::${collection}` : null;
  const [data, setData] = React.useState<{ key: string; fields: string[] } | null>(null);
  const fields = data && data.key === cacheKey ? data.fields : null;

  React.useEffect(() => {
    if (!cacheKey || !connectionId || !dbName || !collection) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const row = await api.prefs.getPreviewFields({ connectionId, dbName, collection });
        if (!cancelled) setData({ key: cacheKey, fields: row?.fields ?? [] });
      } catch {
        // Treat any failure as "no preference set" — TreeView falls back
        // to a generic preview, which is the same UX as a fresh collection.
        if (!cancelled) setData({ key: cacheKey, fields: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cacheKey, connectionId, dbName, collection]);

  const update = React.useCallback(
    (next: string[]) => {
      if (cacheKey) setData({ key: cacheKey, fields: next });
      if (!connectionId || !dbName || !collection) return;
      void api.prefs
        .setPreviewFields({ connectionId, dbName, collection, fields: next })
        .catch(() => {
          // Fire-and-forget: the in-memory state is already updated; a
          // persistence failure shouldn't block the UI.
        });
    },
    [cacheKey, connectionId, dbName, collection],
  );

  return [fields, update];
}
