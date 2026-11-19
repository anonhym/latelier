/** The most fields a collapsed Tree row can show. */
export const ROW_SUMMARY_MAX_FIELDS = 4;

/**
 * Why a Row Summary's field list is not acceptable, or `null` when it is.
 * One to four dotted paths, none empty, none repeated, and never `_id`: the
 * collapsed row already shows it.
 */
export function rowSummaryFieldsProblem(fields: readonly string[]): string | null {
  if (fields.length < 1 || fields.length > ROW_SUMMARY_MAX_FIELDS) {
    return `a row summary takes 1 to ${ROW_SUMMARY_MAX_FIELDS} fields, got ${fields.length}`;
  }
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.trim() === '') return 'a row summary field cannot be empty';
    if (field === '_id') return 'a row summary cannot include _id';
    if (seen.has(field)) return `a row summary cannot repeat the field '${field}'`;
    seen.add(field);
  }
  return null;
}
