import type React from 'react';
import { copyToClipboard } from '../../../utils/clipboard';
import { formatDocsForCopy, type CopyFormat } from '../../../utils/copyFormat';

/**
 * `⌘C` / `⌘⇧C` on a result view (W06 §8.6): `'primary'` for ⌘C (the active
 * cell in Table, the active document in Tree and JSON), `'document'` for ⌘⇧C.
 *
 * `null` leaves the key to the browser: a text selection or a text field keeps
 * the native copy, and so does any other key chord.
 */
export function copyShortcutOf(e: React.KeyboardEvent): 'primary' | 'document' | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== 'c') return null;
  if (isTextTarget(e.target)) return null;
  if ((window.getSelection()?.toString() ?? '') !== '') return null;
  return e.shiftKey ? 'document' : 'primary';
}

function isTextTarget(target: EventTarget): boolean {
  return target instanceof HTMLElement && target.closest('input, textarea, [contenteditable=""], [contenteditable="true"]') !== null;
}

/** Copy one document in `format`, with the shared "Copied" toast. */
export function copyDocument(doc: unknown, format: CopyFormat): Promise<boolean> {
  return copyToClipboard(formatDocsForCopy([doc], format), 'Document copied to the clipboard.');
}
