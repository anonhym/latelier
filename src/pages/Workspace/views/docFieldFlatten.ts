import { isRecord, toDisplayValue } from '../../../utils/displayValue';

export interface FlatFieldRow {
  /** Same `path` key `FieldNode` (`DocFieldTree.tsx`) uses for expansion
   * state and its own `id`. */
  path: string;
  /** Whether this row can be expanded — an Enter/Space on a non-expandable
   * active row is a no-op, same as clicking one (`FieldNode`'s `rowClickable`). */
  expandable: boolean;
}

/**
 * The document's field rows in the exact order `FieldNode`'s own recursion
 * (`DocFieldTree.tsx`) renders them — top-level fields, and (only for a
 * currently-expanded path) its children immediately after it, depth-first.
 * This is what #20's roving focus needs to turn "ArrowDown" into "the next
 * visible row": unlike `TableView`/`TreeView` (one roving row per document,
 * a fixed count), a field tree's row count and order change as the user
 * expands/collapses sibling fields, so there's no static index to roll a
 * highlight over — it has to be recomputed from `doc` + `expandedPaths` on
 * every render.
 *
 * Pulled out of `DocFieldTree.tsx` (a components-only file, same reason
 * `docId.ts` lives next to it as its own module) so this pure function gets
 * fast `tests/unit/` coverage without needing a DOM.
 */
export function flattenVisibleFieldRows(
  doc: Record<string, unknown>,
  docId: string,
  expandedPaths: Set<string>,
): FlatFieldRow[] {
  const out: FlatFieldRow[] = [];
  const visit = (entries: Array<[string, unknown]>, parentPath: string, sep: string) => {
    for (const [name, value] of entries) {
      const path = `${parentPath}${sep}${name}`;
      const dv = toDisplayValue(value);
      const expandable = dv.type === 'object' || dv.type === 'array';
      out.push({ path, expandable });
      if (!expandable || !expandedPaths.has(path)) continue;
      if (dv.type === 'array' && Array.isArray(value)) {
        visit(value.map((v, i): [string, unknown] => [String(i), v]), path, '.');
      } else if (isRecord(value)) {
        visit(Object.entries(value), path, '.');
      }
    }
  };
  visit(Object.entries(doc), docId, '::');
  return out;
}
