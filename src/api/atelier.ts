// Typed accessor for the preload-injected `window.atelier` bridge.
import type { IpcApi, IpcError } from '@shared/ipc';

declare global {
  interface Window {
    atelier?: IpcApi;
  }
}

export function getApi(): IpcApi {
  const api = window.atelier;
  if (!api) {
    throw new Error(
      'window.atelier is not available. Are you running inside Electron with preload enabled?',
    );
  }
  return api;
}

/**
 * Narrow test for thrown IpcError objects. The preload throws the `error`
 * shape directly so callers can switch on `error.code`.
 */
export function isIpcError(e: unknown): e is IpcError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof (e as { code?: unknown }).code === 'string' &&
    'message' in e
  );
}

export function getErrorMessage(e: unknown, fallback: string): string {
  if (typeof e === 'object' && e !== null && 'message' in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return fallback;
}

export const api = new Proxy({} as IpcApi, {
  get(_target, prop: string | symbol) {
    const a = getApi() as unknown as Record<string | symbol, unknown>;
    return a[prop];
  },
});
