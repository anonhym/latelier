import { useRegisterCommands } from '../commands/useRegisterCommands';
import { useTroubleshooting } from './TroubleshootingContext';

/**
 * Registers the `troubleshooting.open` palette command. Lives next to the
 * provider so the perform closes over the same hook instance the drawer
 * uses; mount once inside `<TroubleshootingProvider>`.
 */
export function TroubleshootingPaletteCommand() {
  const help = useTroubleshooting();
  useRegisterCommands(
    [
      {
        id: 'troubleshooting.open',
        title: 'Open connection troubleshooting',
        subtitle: 'Browse the recipes for common connection failures',
        group: 'general',
        keywords: ['help', 'fix', 'error', 'connect', 'tls'],
        perform: () => help.open(),
      },
    ],
    [help],
  );
  return null;
}
