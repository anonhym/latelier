import React from 'react';
import { copySourceOf, recordCopyOrigin, type CopySource } from '../../../utils/copyOrigin';
import { useLatest } from '../../../commands/useLatest';

/**
 * The `onCopy` handler for a result view's container. A native copy of text
 * selected inside the view is a data-bearing copy the app never sees
 * otherwise, so it is recorded as the Copy Origin of the tab the view is in.
 *
 * It only observes: the copy itself is the browser's and is never prevented.
 * An empty selection (a copy with nothing selected writes nothing) records
 * nothing and leaves the remembered copy as it was.
 */
export function useResultCopyOrigin(origin: CopySource): React.ClipboardEventHandler {
  const originRef = useLatest(origin);
  return React.useCallback(() => {
    const selected = window.getSelection()?.toString() ?? '';
    if (selected === '') return;
    recordCopyOrigin(copySourceOf(originRef.current), selected);
  }, [originRef]);
}
