import * as React from 'react';
import { useCollectionWorkspace } from '../context';
import { recallScroll, rememberScroll } from './scrollMemory';

/**
 * Props that make a react-window `List` restore the vertical scroll it had when
 * the view last unmounted and record it as the reader scrolls (W06 §8.12).
 * A view switch unmounts the view; a tab switch can reuse it, so the list is
 * keyed by `listKey` (spread-excluded) to remount at the destination's offset.
 */
export function useScrollMemory(view: 'Table' | 'Tree' | 'JSON') {
  const tabId = useCollectionWorkspace().meta.tabId;
  // The list takes it as its initial offset only, hence the remount per tab.
  const defaultScrollOffset = React.useMemo(() => recallScroll(tabId, view), [tabId, view]);
  const onScroll = React.useCallback(
    (e: React.UIEvent<HTMLElement>) => rememberScroll(tabId, view, e.currentTarget.scrollTop),
    [tabId, view],
  );
  return { listKey: tabId, defaultScrollOffset, onScroll };
}
