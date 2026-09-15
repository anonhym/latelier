/**
 * Convention shared with `electron/services/ReferenceRulesService` autodetect:
 * a field whose name ends in `_id` or `Id` (excluding `_id` itself) likely
 * points at another collection.
 */
const FOREIGN_ID_RE = /(_id|Id)$/;

export function looksLikeForeignIdField(name: string): boolean {
  return name !== '_id' && FOREIGN_ID_RE.test(name);
}
