import path from 'node:path';

export type BridgeOs = 'mac' | 'win' | 'linux';

const APP_DIR_NAME = "L'Atelier";
const BRIDGE_BASENAME = 'latelier-agent-bridge';

/** The path flavour of `platform`, so a test on one OS can check another's strings. */
function pathFor(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix;
}

/** The OS name the build script and `electron-builder` use for a bridge directory. */
export function bridgeOs(platform: NodeJS.Platform): BridgeOs {
  if (platform === 'darwin') return 'mac';
  return platform === 'win32' ? 'win' : 'linux';
}

export function bridgeFileName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? `${BRIDGE_BASENAME}.exe` : BRIDGE_BASENAME;
}

export interface BundledBridgeInput {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  /** `process.resourcesPath`; read only when packaged. */
  resourcesPath: string;
  /** The app's source root, where `build/bridge/<os>-<arch>/` lives in development. */
  appRoot: string;
}

/**
 * Where the bridge that ships with this build is: `bin/` among the packaged
 * resources, or the build script's output directory in development.
 */
export function bundledBridgePath(input: BundledBridgeInput): string {
  const p = pathFor(input.platform);
  const file = bridgeFileName(input.platform);
  if (input.isPackaged) return p.join(input.resourcesPath, 'bin', file);
  return p.join(input.appRoot, 'build', 'bridge', `${bridgeOs(input.platform)}-${input.arch}`, file);
}

export interface InstalledBridgeInput {
  platform: NodeJS.Platform;
  /** The app's userData directory; used only by a test instance. */
  userData: string;
  /** True when `ATELIER_USER_DATA_DIR` is set: a throwaway profile must not touch the real per-user copy. */
  testInstance: boolean;
  env: Record<string, string | undefined>;
  homedir: string;
}

/**
 * The fixed per-user directory the Agent client configuration points into
 * (X27 §15 question 5). It does not move with the app, an update or an
 * AppImage mount.
 */
export function installedBridgeDir(input: InstalledBridgeInput): string {
  const p = pathFor(input.platform);
  if (input.testInstance) return p.join(input.userData, 'bin');
  if (input.platform === 'darwin') return p.join(input.homedir, 'Library', 'Application Support', APP_DIR_NAME, 'bin');
  if (input.platform === 'win32') {
    const local = input.env.LOCALAPPDATA || p.join(input.homedir, 'AppData', 'Local');
    return p.join(local, APP_DIR_NAME, 'bin');
  }
  const xdg = input.env.XDG_DATA_HOME;
  const dataHome = xdg && p.isAbsolute(xdg) ? xdg : p.join(input.homedir, '.local', 'share');
  return p.join(dataHome, APP_DIR_NAME, 'bin');
}

export function installedBridgePath(input: InstalledBridgeInput): string {
  return pathFor(input.platform).join(installedBridgeDir(input), bridgeFileName(input.platform));
}
