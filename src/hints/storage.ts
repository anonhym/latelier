import { api } from '../api/atelier';
import type { FeatureHintDismissalState, FeatureHintId } from '@shared/types';

const KEY = 'ui.hints.dismissed';

export async function getDismissedHints(): Promise<FeatureHintDismissalState> {
  const v = await api.prefs.get<FeatureHintDismissalState>(KEY);
  return v ?? { dismissedIds: [] };
}

export async function dismissHint(id: FeatureHintId): Promise<void> {
  const cur = await getDismissedHints();
  if (cur.dismissedIds.includes(id)) return;
  await api.prefs.set<FeatureHintDismissalState>(KEY, {
    ...cur,
    dismissedIds: [...cur.dismissedIds, id],
  });
}

export async function resetHints(): Promise<void> {
  await api.prefs.set<FeatureHintDismissalState>(KEY, {
    dismissedIds: [],
    resetAt: new Date().toISOString(),
  });
}
