import type { Logger } from '../log.ts';
import type { UpdaterLike } from '../services/UpdateService.ts';

/**
 * electron-updater is CommonJS and exposes `autoUpdater` through a lazy getter
 * that Node's named-export detection cannot see, so under the ESM main the
 * export lives on `default`. Loaded on demand: never in dev or under e2e.
 */
export async function loadUpdater(log: Logger): Promise<UpdaterLike> {
  const mod = (await import('electron-updater')) as unknown as {
    default?: { autoUpdater?: UpdaterLike & { logger: unknown } };
  };
  const autoUpdater = mod.default?.autoUpdater;
  if (!autoUpdater) {
    throw new Error('electron-updater did not expose default.autoUpdater');
  }
  const adapt = (level: 'debug' | 'info' | 'warn' | 'error') => (msg?: unknown) =>
    log[level]('updater', String(msg));
  autoUpdater.logger = {
    debug: adapt('debug'),
    info: adapt('info'),
    warn: adapt('warn'),
    error: adapt('error'),
  };
  return autoUpdater;
}
