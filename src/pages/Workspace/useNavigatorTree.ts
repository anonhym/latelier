import React from 'react';
import {
  navigatorTreeReducer,
  initialNavigatorTreeState,
  type NavigatorTreeState,
  type NavigatorTreeAction,
} from './navigatorTreeReducer';

// Guards dispatch after unmount: React's dispatch reads `window`, which throws once jsdom tears down mid-flight IPC.
// Re-arms mountedRef in the effect body (not just cleanup) so StrictMode's cleanup-then-remount doesn't leave it permanently false.
// `isMounted` lets a multi-step async load stop before issuing its next IPC call, not only before dispatching the result.
export function useNavigatorTree(): {
  state: NavigatorTreeState;
  dispatch: React.Dispatch<NavigatorTreeAction>;
  isMounted: () => boolean;
} {
  const [state, rawDispatch] = React.useReducer(
    navigatorTreeReducer,
    initialNavigatorTreeState,
  );
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const dispatch = React.useCallback<React.Dispatch<NavigatorTreeAction>>((action) => {
    if (!mountedRef.current) return;
    rawDispatch(action);
  }, []);
  const isMounted = React.useCallback(() => mountedRef.current, []);
  return { state, dispatch, isMounted };
}
