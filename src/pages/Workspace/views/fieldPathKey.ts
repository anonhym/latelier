/**
 * Identity keys for field-tree rows (`DocFieldTree`, `JsonTree`) that stay
 * collision-free even when a field's own name contains `.` or `:` (#86).
 *
 * The pre-#86 scheme joined segments with plain concatenation
 * (`${parent}.${name}`), so a top-level field literally named `"a.b"` and a
 * nested field `b` under top-level `"a"` produced the identical string.
 * Escaping each segment before joining removes the ambiguity: `\` is escaped
 * first (so an escaped separator round-trips unambiguously), then `.` and
 * `:` — the two characters these keys use as structural separators (`:`
 * doubles as the docId/field divider in `rootKey`).
 *
 * `fieldPath` (the user-facing Mongo dot-path used by copy / Add to filter /
 * drag / refs) is a separate, unescaped value and must stay that way — only
 * this identity key changes.
 */
export function escapeKeySegment(segment: string): string {
  return segment.replace(/\\/g, '\\\\').replace(/\./g, '\\.').replace(/:/g, '\\:');
}

/** Root row key: escaped `docId` + escaped top-level field name. */
export function rootKey(docId: string, field: string): string {
  return `${escapeKeySegment(docId)}::${escapeKeySegment(field)}`;
}

/** Child row key: `parentKey` is already a complete escaped key; only the
 * new segment needs escaping. */
export function childKey(parentKey: string, name: string): string {
  return `${parentKey}.${escapeKeySegment(name)}`;
}

/**
 * True iff `child` names `parent`'s own row or a row anywhere in its
 * subtree. `child` is nullable so callers can pass an `activePath`/
 * `copiedPath` that may not point at any row at all (`null` always reads as
 * "not covered"); `parent` is always a concrete row's own key.
 *
 * `escapeKeySegment` can never leave a key ending in an odd number of
 * trailing backslashes — every raw `\` it escapes becomes exactly two — so a
 * `.` immediately following a complete key is always a real level
 * separator, never an escaped `.` that happens to sit at the boundary. That
 * makes the plain prefix check below safe; proved with fast-check in
 * `fieldPathKey.property.spec.ts`.
 */
export function pathCoversSubtree(parent: string, child: string | null): boolean {
  return child !== null && (child === parent || child.startsWith(`${parent}.`));
}
