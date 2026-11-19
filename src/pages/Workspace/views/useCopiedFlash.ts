import React from 'react';
import { copyToClipboard } from '../../../utils/clipboard';
import { withFieldPath, type CopySource } from '../../../utils/copyOrigin';
import { useLatest } from '../../../commands/useLatest';

/**
 * Copy-to-clipboard with a 600ms "copied" badge on the key that was copied.
 * Badge, not toast — a toast per cell copy would be noise; a failed copy
 * toasts instead (`copyToClipboard` does that itself).
 *
 * `origin` is the tab the value is copied in, recorded as the Copy Origin.
 */
export function useCopiedFlash<K>(origin?: CopySource) {
  const [copied, setCopied] = React.useState<K | null>(null);
  const originRef = useLatest(origin);
  // `fieldPath` is the document field `text` is the value of, when it is one.
  const flash = React.useCallback((text: string, key: K, fieldPath?: string) => {
    const current = originRef.current;
    const source = fieldPath === undefined ? current : withFieldPath(current, fieldPath);
    void copyToClipboard(text, undefined, source).then((ok) => {
      if (!ok) return;
      setCopied(key);
      window.setTimeout(() => {
        setCopied((prev) => (prev === key ? null : prev));
      }, 600);
    });
  }, [originRef]);
  return { copied, flash };
}
