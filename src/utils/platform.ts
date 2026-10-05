/** True when the renderer runs on macOS; `platform` comes from the preload's `__atelierEnv__`. */
export function isMacRenderer(): boolean {
  const env = (window as unknown as { __atelierEnv__?: { platform?: string } }).__atelierEnv__;
  return env?.platform === 'darwin';
}
