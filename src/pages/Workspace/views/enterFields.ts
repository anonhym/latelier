/**
 * `→` on an expanded document row: move focus into that document's field
 * tree. The row element and the tree share one `data-selected` wrapper in
 * both Table and Tree. Returns whether a tree was there to enter.
 */
export function enterFields(rowDomId: string): boolean {
  const section = document
    .getElementById(rowDomId)
    ?.closest('[data-selected]')
    ?.querySelector<HTMLElement>('[data-expanded-doc-section="true"]');
  section?.focus();
  return section != null;
}
