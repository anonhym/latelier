import { useEffect, useRef } from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import { notify } from '../../theme/notifications';
import { restartToUpdate } from './updateActions';
import { useUpdatePillMounted, useUpdateState } from './updateStateContext';

const TOAST_ID = 'update-ready';
const TOAST_SHOWN_KEY = 'update.toastShownFor';

function showReady(version: string): void {
  notify.info(`Version ${version} is ready`, {
    id: TOAST_ID,
    autoClose: false,
    action: {
      label: 'Restart to update',
      onClick: () => {
        void restartToUpdate();
      },
    },
  });
}

/**
 * Renders nothing: wherever no status-bar pill is on screen (the Connections
 * screens, and the welcome canvas, which has no status bar), surfaces one
 * non-modal toast per version once an update has downloaded (X22 §4).
 */
export function UpdateReadyPrompt() {
  const state = useUpdateState();
  const pillShown = useUpdatePillMounted();
  const readyVersion = state.status === 'ready' ? state.version : null;
  // The pref write is async: this stops a re-run in the same session from
  // reading the old value and showing the toast a second time.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (readyVersion === null || pillShown || handled.current === readyVersion) return;
    let cancelled = false;
    api.prefs
      .get<unknown>(TOAST_SHOWN_KEY)
      .then((stored) => {
        if (cancelled) return;
        handled.current = readyVersion;
        if (stored === readyVersion) return;
        showReady(readyVersion);
        api.prefs
          .set(TOAST_SHOWN_KEY, readyVersion)
          .catch((err) => logFailure('saving the version the update toast was shown for', err));
      })
      // The toast is optional: an unreadable preference shows nothing, and the
      // pill and Settings still say an update is ready.
      .catch((err) => logFailure('reading the version the update toast was shown for', err));
    return () => {
      cancelled = true;
    };
  }, [readyVersion, pillShown]);

  return null;
}
