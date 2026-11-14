import type { ContextMenuItem } from '../../../components/ContextMenu';
import { copyToClipboard } from '../../../utils/clipboard';
import { formatDocsForCopy, type CopyFormat } from '../../../utils/copyFormat';
import { isRecord, valueToClipboardText } from '../../../utils/displayValue';
import { getDocIdText } from './docId';

export interface FieldMenuInput {
  fieldPath: string;
  value: unknown;
  /** Gates Copy value and Add to filter; Copy field path always renders. */
  hasValue: boolean;
  isReadOnly?: boolean;
  /** Add to filter disables up front when the filter bar's text doesn't parse. */
  filterBarValid: boolean;
  onAddToFilter: (fieldPath: string, value: unknown) => Promise<void>;
}

/** Copy value / Copy field path / Add to filter — shared by the cell, field and header menus' field half. */
export function fieldMenuItems({
  fieldPath,
  value,
  hasValue,
  isReadOnly,
  filterBarValid,
  onAddToFilter,
}: FieldMenuInput): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (hasValue) {
    items.push({
      kind: 'item',
      label: 'Copy value',
      onClick: () => void copyToClipboard(valueToClipboardText(value), 'Value copied to the clipboard.'),
    });
  }
  items.push({
    kind: 'item',
    label: 'Copy field path',
    onClick: () => void copyToClipboard(fieldPath, 'Field name copied to the clipboard.'),
  });
  if (!isReadOnly && hasValue) {
    items.push({
      kind: 'item',
      label: 'Add to filter',
      disabled: !filterBarValid,
      disabledTitle: "The filter bar's text isn't valid JSON",
      onClick: () => void onAddToFilter(fieldPath, value),
    });
  }
  return items;
}

export interface DocMenuInput {
  doc: unknown;
  copyFormat: CopyFormat;
  onEdit: (doc: unknown) => void;
  /** Omitted for read-only providers. */
  onDuplicate?: (doc: unknown) => void;
  onDelete: (doc: unknown) => void;
  /** Omitted where the view has no per-field expansion to drive. */
  onExpandAll?: (doc: unknown) => void;
  onCollapseAll?: (doc: unknown) => void;
  isReadOnly?: boolean;
  /** A view's document can only be looked at: Edit becomes View and the writes go. */
  isView?: boolean;
}

/** The document's menu, in the order W06 §8.7 gives. */
export function docMenuItems({
  doc,
  copyFormat,
  onEdit,
  onDuplicate,
  onDelete,
  onExpandAll,
  onCollapseAll,
  isReadOnly,
  isView,
}: DocMenuInput): ContextMenuItem[] {
  const hasId = isRecord(doc) && doc._id !== undefined && doc._id !== null;
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      label: 'Copy document',
      onClick: () =>
        void copyToClipboard(formatDocsForCopy([doc], copyFormat), 'Document copied to the clipboard.'),
    },
  ];
  if (hasId) {
    items.push({
      kind: 'item',
      label: 'Copy _id',
      onClick: () => void copyToClipboard(getDocIdText(doc), 'Document id copied to the clipboard.'),
    });
  }
  items.push({
    kind: 'item',
    label: isView ? 'View document' : 'Edit document',
    onClick: () => onEdit(doc),
  });
  if (!isReadOnly && !isView && onDuplicate) {
    items.push({ kind: 'item', label: 'Duplicate document', onClick: () => onDuplicate(doc) });
  }
  if (onExpandAll) items.push({ kind: 'item', label: 'Expand all', onClick: () => onExpandAll(doc) });
  if (onCollapseAll) items.push({ kind: 'item', label: 'Collapse all', onClick: () => onCollapseAll(doc) });
  if (!isView) {
    items.push({ kind: 'item', label: 'Delete', destructive: true, onClick: () => onDelete(doc) });
  }
  return items;
}
