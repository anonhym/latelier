import { useEffect } from 'react';
import { api } from '../../api/atelier';
import { flushAll } from '../../state/pendingFlush';

/**
 * Renders nothing: answers main's flush request before it quits or closes the
 * window. Main ends the app with `app.exit`, which skips the page's unload
 * events, so the held-back tab edits go out here instead. It answers even with
 * nothing registered (no Workspace mounted), so main does not wait out its
 * timeout for nothing.
 */
export function FlushOnQuit() {
  useEffect(
    () =>
      api.app.onFlushRequest(() => {
        void flushAll().finally(() => api.app.flushDone());
      }),
    [],
  );
  return null;
}
