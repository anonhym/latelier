import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { getCopyOrigin } from '../../utils/copyOrigin';
import {
  findValueMatch,
  isSuppressed,
  orientPair,
  pairKey,
  pendingValuesFor,
  readNeverList,
  withNeverPair,
} from '../../utils/referenceDiscovery';
import {
  armDiscovery,
  clearSuggestion,
  DISCOVERY_NEVER_PREF_KEY,
  declineForCopy,
  isDeclinedForCopy,
  showSuggestion,
  takePendingDiscovery,
  type ReferenceSuggestion,
} from '../../state/referenceDiscovery';

/** The tab a paste landed in, or a Run finished in. */
export interface DiscoveryTarget {
  tabId: string;
  connectionId: string;
  dbName: string;
  collection: string;
}

/**
 * A paste into a query surface of `target`. When it carries a value copied
 * from one field of another Collection of the same Connection, the tab's next
 * Run looks for that value. It only observes, and never touches the paste.
 */
export function armReferenceDiscovery(target: DiscoveryTarget, pasted: string): void {
  const origin = getCopyOrigin();
  const values = pendingValuesFor(origin, target, pasted);
  if (origin === null || origin.fieldPath === undefined || values === null) return;
  armDiscovery(target.tabId, {
    origin: { dbName: origin.dbName, collection: origin.collection, field: origin.fieldPath },
    seq: origin.seq,
    values,
  });
}

/**
 * The tab's Run finished with `documents`. A pending discovery is taken
 * whatever they hold; when one holds a copied value and nothing suppresses the
 * pair, the tab gets a suggestion. Failing to read the settings shows nothing,
 * and says why in the log.
 */
export async function settleReferenceDiscovery(target: DiscoveryTarget, documents: readonly unknown[]): Promise<void> {
  const pending = takePendingDiscovery(target.tabId);
  if (pending === undefined) return;
  const field = findValueMatch(documents, pending.values);
  if (field === null) return;
  const pair = orientPair(pending.origin, { dbName: target.dbName, collection: target.collection, field });
  if (pair === null) return;
  const key = pairKey(target.connectionId, pair);
  try {
    const [never, rules, families] = await Promise.all([
      api.prefs.get<unknown>(DISCOVERY_NEVER_PREF_KEY),
      // `effective` makes every row carry the Family's shared rules too.
      api.refs.list({
        connectionId: target.connectionId,
        dbName: pair.source.dbName,
        collection: pair.source.collection,
        effective: true,
      }),
      api.families.list(),
    ]);
    if (
      isSuppressed({
        key,
        source: pair.source,
        never: readNeverList(never),
        declined: isDeclinedForCopy(pending.seq, key),
        rules,
      })
    ) {
      return;
    }
    const family = families.find((f) => f.memberIds.includes(target.connectionId));
    showSuggestion(target.tabId, {
      pair,
      key,
      seq: pending.seq,
      connectionId: target.connectionId,
      family: family ? { id: family.id, name: family.name } : null,
    });
  } catch (err) {
    logFailure('looking for a reference rule', err);
  }
}

/** Where a saved suggestion lives: the Family it is shared with by default, or the Connection alone. */
export type SuggestionScope = 'default' | 'connection';

const savedListeners = new Set<() => void>();

/**
 * Runs `listener` after a suggested rule is saved, so a reader of the rules
 * (the mounted tab's `useReferenceRules`) can reload them: without it the
 * results gain no chip for the new rule until the tab changes. Returns the unsubscribe.
 */
export function onSuggestionSaved(listener: () => void): () => void {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
}

/** Create the suggested rule. The strip stays when this throws. */
export async function saveSuggestion(tabId: string, s: ReferenceSuggestion, scope: SuggestionScope): Promise<void> {
  // The Family was captured when the suggestion was made. Joining or leaving one since would send the rule to a Family this Connection is no longer in.
  const family = (await api.families.list()).find((f) => f.memberIds.includes(s.connectionId));
  if ((family?.id ?? null) !== (s.family?.id ?? null)) {
    clearSuggestion(tabId);
    throw new Error("This connection's family changed since the suggestion was made. Copy the value again for a fresh one.");
  }
  const owner = s.family !== null && scope === 'default' ? { familyId: s.family.id } : { connectionId: s.connectionId };
  await api.refs.create({
    owner,
    sourceDb: s.pair.source.dbName,
    sourceCollection: s.pair.source.collection,
    sourceField: s.pair.source.field,
    targetDb: s.pair.target.dbName,
    targetCollection: s.pair.target.collection,
    targetField: s.pair.target.field,
  });
  for (const listener of savedListeners) listener();
  clearSuggestion(tabId);
}

/** Not now: gone, and not offered again for this copy. */
export function declineSuggestion(tabId: string, s: ReferenceSuggestion): void {
  declineForCopy(s.seq, s.key);
  clearSuggestion(tabId);
}

/** Never for this pair: remembered across restarts. The strip stays when the write throws. */
export async function neverSuggest(tabId: string, s: ReferenceSuggestion): Promise<void> {
  const stored = readNeverList(await api.prefs.get<unknown>(DISCOVERY_NEVER_PREF_KEY));
  await api.prefs.set(DISCOVERY_NEVER_PREF_KEY, withNeverPair(stored, s.key));
  clearSuggestion(tabId);
}
