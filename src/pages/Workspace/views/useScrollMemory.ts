import * as React from 'react';
import { useCollectionWorkspace } from '../context';
import { recallScroll, rememberScroll } from './scrollMemory';

/**
 * Props that make a react-window `List` restore the vertical scroll it had when
 * the view last unmounted and record it as the reader scrolls (W06 §8.12).
 * The view unmounts on a view or tab switch, so mount is where it is read back.
 */
export function useScrollMemory(view: 'Table' | 'Tree' | 'JSON') {
  const tabId = useCollectionWorkspace().meta.tabId;
  // Read once per mount: the list takes it as its initial offset only.
  const [defaultScrollOffset] = React.useState(() => recallScroll(tabId, view));
  const onScroll = React.useCallback(
    (e: React.UIEvent<HTMLElement>) => rememberScroll(tabId, view, e.currentTarget.scrollTop),
    [tabId, view],
  );
  return { defaultScrollOffset, onScroll };
}
