import React from 'react';
import type { EffectiveReferenceRule, ReferenceRule } from '@shared/types';
import { api, isIpcError } from '../../api/atelier';

// A Family change (joining, leaving, deleting, applying an export) happens in a
// dialog with no common parent to the mounted readers, so it announces itself
// here and every reader re-asks for what its Connection now uses.
const changed = new EventTarget();

export function notifyReferenceRulesChanged(): void {
  changed.dispatchEvent(new Event('changed'));
}

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

  // Only the newest read may settle: a slower answer for the previous Collection must not overwrite this one's.
  const latest = React.useRef(0);

  const reload = React.useCallback(async () => {
    const mine = ++latest.current;
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
      if (mine === latest.current) setRules(rows.filter((r) => r.enabled));
    } catch (err) {
      if (mine === latest.current) {
        setError(isIpcError(err) ? err.message : String(err));
        setRules([]);
      }
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, [connectionId, dbName, collection]);

  React.useEffect(() => {
    queueMicrotask(() => {
      void reload();
    });
  }, [reload]);

  React.useEffect(() => {
    const onChanged = () => void reload();
    changed.addEventListener('changed', onChanged);
    return () => changed.removeEventListener('changed', onChanged);
  }, [reload]);

  const byField = React.useMemo(() => {
    const map = new Map<string, ReferenceRule>();
    for (const r of rules) map.set(r.sourceField, r);
    return map;
  }, [rules]);

  return { rules, byField, loading, error, reload };
}
