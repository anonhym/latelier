import { notify } from '../theme/notifications';
import { clearCopyOrigin, recordCopyOrigin, type CopyOriginSource } from './copyOrigin';

const CLIPBOARD_TOAST_ID = 'clipboard-copied';

/**
 * Copy `text` and say so. W15 §13.7: a copy button that reports
 * nothing is indistinguishable from a broken one, and `navigator.clipboard`
 * really does reject (denied permission, non-secure context, a headless
 * environment with no clipboard) — a silent rejection tells the user the
 * copy worked when it did not.
 *
 * Every copy action in the renderer goes through here. Omit
 * `successMessage` when the caller already shows its own success feedback —
 * an inline "✓ Copied" badge, say, which a toast would only duplicate. The
 * badge must be driven off the resolved `true`, never set alongside the
 * call. Failure always toasts, whatever the caller does.
 *
 * `origin` is where the copied text came from. A data-bearing copy (a value,
 * a document id, a document, several documents, an aggregation output) passes
 * it and becomes the remembered Copy Origin, but only once the write
 * succeeded: a failed write leaves the previous one standing. A copy with no
 * `origin` (a field name, a namespace, a query, a pipeline, a command, a
 * connection string) clears it. The third argument is optional, so a call site
 * added later and forgotten clears the origin rather than recording a wrong
 * one.
 */
export async function copyToClipboard(
  text: string,
  successMessage?: string,
  origin?: CopyOriginSource,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (origin) recordCopyOrigin(origin, text);
    else clearCopyOrigin();
    // One fixed id: six copies in a row leave one toast, not six.
    if (successMessage) notify.success(successMessage, { id: CLIPBOARD_TOAST_ID, autoClose: 1500 });
    return true;
  } catch {
    notify.error('Could not copy to the clipboard.');
    return false;
  }
}
