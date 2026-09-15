import { useEffect } from 'react';
import { commandRegistry } from './registry';
import type { Command } from './types';

/**
 * Register a list of commands with the global palette registry. Re-registers
 * (replacing prior entries by id) when `deps` change. Closures captured by
 * `perform` see the values from the most recent render whose deps fired.
 *
 * Pair with the `additionalHooks` ESLint config so `react-hooks/exhaustive-deps`
 * lints the `deps` array (otherwise stale closures slip in unnoticed).
 */
export function useRegisterCommands(commands: Command[], deps: React.DependencyList): void {
  useEffect(() => {
    const unregister = commandRegistry.add(commands);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
