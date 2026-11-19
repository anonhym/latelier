import React from 'react';
import type { EffectiveReferenceRule, ReferenceRule } from '@shared/types';
import { api, isIpcError } from '../../api/atelier';

export interface UseReferenceRulesResult {
  /** What the Connection uses: its own rules plus its Family's shared ones it does not override. */
  rules: EffectiveReferenceRule[];
  byField: Map<string, ReferenceRule>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

/**
 * Load the enabled reference rules for a specific source collection. Returns
 * both the rule list and an index keyed by `sourceField` so renderers can
 * look up rules in O(1) while walking document fields.
 */
export function useReferenceRules(
  connectionId: string | null,
  dbName: string | null,
  collection: string | null,
): UseReferenceRulesResult {
  const [rules, setRules] = React.useState<EffectiveReferenceRule[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    if (!connectionId || !dbName || !collection) {
      setRules([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // `effective` makes every row an `EffectiveReferenceRule`; the bridge types it as the base rule.
      const rows = (await api.refs.list({
        connectionId,
        dbName,
        collection,
        effective: true,
      })) as EffectiveReferenceRule[];
      setRules(rows.filter((r) => r.enabled));
    } catch (err) {
      setError(isIpcError(err) ? err.message : String(err));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => {
      void reload();
    });
  }, [reload]);

  const byField = React.useMemo(() => {
    const map = new Map<string, ReferenceRule>();
    for (const r of rules) map.set(r.sourceField, r);
    return map;
  }, [rules]);

  return { rules, byField, loading, error, reload };
}
