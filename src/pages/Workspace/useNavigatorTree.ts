import React from 'react';
import {
  navigatorTreeReducer,
  initialNavigatorTreeState,
  type NavigatorTreeState,
  type NavigatorTreeAction,
} from './navigatorTreeReducer';

// Guards dispatch after unmount: React's dispatch reads `window`, which throws once jsdom tears down mid-flight IPC.
// Re-arms mountedRef in the effect body (not just cleanup) so StrictMode's cleanup-then-remount doesn't leave it permanently false.
export function useNavigatorTree(): {
  state: NavigatorTreeState;
  dispatch: React.Dispatch<NavigatorTreeAction>;
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
  return { state, dispatch };
}
