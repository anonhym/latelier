/**
 * The pure side of the Row Summary: how a draft list of fields is checked and
 * reordered, and how a document is read through one. Main re-checks every
 * save, so this only keeps the picker honest before it asks.
 */

/** The most fields a collapsed Tree row can show. */
export const ROW_SUMMARY_MAX_FIELDS = 4;

/** Why a draft is not saveable, or `null` when it is. */
export function rowSummaryProblem(fields: readonly string[]): string | null {
  if (fields.length < 1) return 'Pick at least one field.';
  if (fields.length > ROW_SUMMARY_MAX_FIELDS) return `A row summary takes at most ${ROW_SUMMARY_MAX_FIELDS} fields.`;
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.trim() === '') return 'A field name cannot be empty.';
    if (field === '_id') return 'The row already shows _id.';
    if (seen.has(field)) return `${field} is listed twice.`;
    seen.add(field);
  }
  return null;
}

/** The list with the entry at `index` moved by `delta` places; the same list when it cannot move. */
export function moveField(fields: readonly string[], index: number, delta: -1 | 1): string[] {
  const to = index + delta;
  if (index < 0 || index >= fields.length || to < 0 || to >= fields.length) return [...fields];
  const next = [...fields];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * One dotted path read from a document: an own top-level key first (a key may
 * itself contain a dot), else down through nested objects. `undefined` when any
 * step is missing or is not an object.
 */
export function valueAtPath(doc: Record<string, unknown>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(doc, path)) return doc[path];
  let at: unknown = doc;
  for (const step of path.split('.')) {
    if (!isPlainObject(at) || !Object.prototype.hasOwnProperty.call(at, step)) return undefined;
    at = at[step];
  }
  return at;
}

/**
 * The `[path, value]` pairs a collapsed row shows: the fields the document has,
 * in the given order, at most four. A field the document lacks is skipped and
 * the next one takes its place, so a sparse row still shows what it has.
 */
export function summaryPairs(doc: Record<string, unknown>, fields: readonly string[]): Array<[string, unknown]> {
  const pairs: Array<[string, unknown]> = [];
  for (const field of fields) {
    if (pairs.length === ROW_SUMMARY_MAX_FIELDS) break;
    if (field === '_id') continue;
    const value = valueAtPath(doc, field);
    if (value !== undefined) pairs.push([field, value]);
  }
  return pairs;
}
