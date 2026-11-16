import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';

/**
 * Restarts into the downloaded update. A refusal (the quit gate said no, or no
 * update is ready) is a toast, and the update installs on quit regardless.
 * Resolves to whether the app is restarting, so a caller can keep its prompt
 * when the user cancelled.
 */
export async function restartToUpdate(): Promise<boolean> {
  try {
    const { restarting } = await api.updates.restart();
    return restarting;
  } catch (e) {
    notify.error(
      `${getErrorMessage(e, 'The update could not be applied')}. It will be applied when you quit.`,
    );
    return false;
  }
}

/** Opens a page in the system browser; a refusal is a toast, not a silent no-op. */
export function openLink(url: string, failure: string): void {
  api.app.openExternal(url).catch((e: unknown) => {
    notify.error(getErrorMessage(e, failure));
  });
}
