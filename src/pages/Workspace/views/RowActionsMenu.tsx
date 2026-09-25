import React from 'react';

/**
 * Shared "More actions" popup content — Edit/Duplicate/Delete for a
 * document. Table's own cell-level context menu renders this below its
 * field-specific items (Copy value / Copy field path / Add to filter);
 * Tree and JSON, which have no per-row context menu at all, render it alone
 * from their own "More actions" button, so a document gets the same
 * Duplicate affordance as Table without a second copy of the item list.
 *
 * Deliberately just the buttons, not the popup's own positioning/dismiss
 * chrome (`role="group"`, `position: fixed`, `useMenuFocus`) — each caller
 * already owns that shell for its own reasons (Table's is shared with the
 * field menu; a standalone one is new for Tree/JSON), so this only owns
 * what's identical between them.
 */
export interface RowActionsMenuProps {
  doc: unknown;
  onEdit: (doc: unknown) => void;
  /** Omitted for read-only providers, same convention as `openDuplicate`
   * on `CollectionWorkspaceActions`. */
  onDuplicate?: (doc: unknown) => void;
  onDelete: (doc: unknown) => void;
  /** Read-only providers show Edit/Delete anyway (they're no-ops there,
   * matching every other per-row Edit/Delete in the app) but never
   * Duplicate — same gate `TableView`'s own menu already applies. */
  isReadOnly?: boolean;
  onClose: () => void;
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  color: 'var(--atelier-text)',
};

export function RowActionsMenu({
  doc,
  onEdit,
  onDuplicate,
  onDelete,
  isReadOnly,
  onClose,
}: RowActionsMenuProps) {
  return (
    <>
      <button
        onClick={() => {
          onEdit(doc);
          onClose();
        }}
        style={itemStyle}
      >
        Edit
      </button>
      {!isReadOnly && onDuplicate && (
        <button
          onClick={() => {
            onDuplicate(doc);
            onClose();
          }}
          style={itemStyle}
        >
          Duplicate document
        </button>
      )}
      <button
        onClick={() => {
          onDelete(doc);
          onClose();
        }}
        style={{ ...itemStyle, color: 'var(--atelier-red)' }}
      >
        Delete
      </button>
    </>
  );
}
