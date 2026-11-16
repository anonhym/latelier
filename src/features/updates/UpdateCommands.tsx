import { api, getErrorMessage } from '../../api/atelier';
import { useRegisterCommands } from '../../commands/useRegisterCommands';
import { notify } from '../../theme/notifications';
import { restartToUpdate } from './updateActions';
import { checkOutcome, offReasonText, paletteHint } from './updateFormat';
import { useMinuteClock, useUpdateState } from './updateStateContext';
import { useWhatsNew } from './whatsNewContext';
import type { Command } from '../../commands/types';

/**
 * Renders nothing: registers the three update commands with the palette
 * (X22 §7). Restart is listed only while an update is ready; the other two
 * are always listed, and Check for updates is disabled while updates are off.
 */
export function UpdateCommands() {
  const state = useUpdateState();
  const whatsNew = useWhatsNew();
  // The hint reads "last checked N min ago", so it re-registers as the minutes pass.
  const now = useMinuteClock();

  const commands: Command[] = [
    {
      id: 'update.check',
      title: 'Check for updates',
      group: 'general',
      keywords: ['update', 'upgrade', 'version', 'new'],
      subtitle: paletteHint(state, now),
      disabledReason: () => (state.status === 'off' ? offReasonText(state.reason) : null),
      perform: async () => {
        try {
          const outcome = checkOutcome(await api.updates.check());
          if (outcome) notify[outcome.kind](outcome.message);
        } catch (err) {
          notify.error(`Couldn't check for updates: ${getErrorMessage(err, 'unknown error')}`);
        }
      },
    },
    {
      id: 'update.whatsNew',
      title: `What's new in ${__APP_VERSION__}`,
      group: 'general',
      keywords: ['changelog', 'release notes', 'changes', 'version'],
      perform: () => whatsNew.open(),
    },
  ];
  if (state.status === 'ready') {
    commands.unshift({
      id: 'update.restart',
      title: `Restart to update to ${state.version}`,
      group: 'general',
      keywords: ['install', 'relaunch', 'upgrade', 'version'],
      perform: async () => {
        await restartToUpdate();
      },
    });
  }

  useRegisterCommands(commands, [state, now, whatsNew]);
  return null;
}
