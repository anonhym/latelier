import type { SettingOrigin } from '@shared/types';

/** How the Reference Rules editor names where a rule came from. */
export const ORIGIN_BADGE: Record<SettingOrigin, { label: string; hint: string }> = {
  shared: { label: 'Shared', hint: "Comes from the family and applies to every member" },
  override: { label: 'Overridden here', hint: 'This connection has its own version of a shared rule' },
  local: { label: 'Local', hint: 'Belongs to this connection only' },
};
