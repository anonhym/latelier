import type { SettingOwner } from '@shared/types';

/** The two nullable owner columns a setting row carries; exactly one is set. */
export interface OwnerColumns {
  connection_id: string | null;
  family_id: string | null;
}

export function ownerColumns(owner: SettingOwner): OwnerColumns {
  if ('connectionId' in owner) return { connection_id: owner.connectionId, family_id: null };
  return { connection_id: null, family_id: owner.familyId };
}

export function columnsOwner(cols: OwnerColumns, what: string): SettingOwner {
  if (cols.connection_id !== null) return { connectionId: cols.connection_id };
  if (cols.family_id !== null) return { familyId: cols.family_id };
  throw new Error(`${what} has no owner`);
}
