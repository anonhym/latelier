import { notify } from '../theme/notifications';

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
 */
export async function copyToClipboard(text: string, successMessage?: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) notify.success(successMessage);
    return true;
  } catch {
    notify.error('Could not copy to the clipboard.');
    return false;
  }
}
