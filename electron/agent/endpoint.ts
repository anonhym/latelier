import path from 'node:path';
import { SystemError } from '../errors.ts';

/** Longest Unix socket path in bytes: `sun_path` less its terminator on macOS (104) and Linux (108). */
const UNIX_PATH_LIMIT: Record<string, number> = { darwin: 103, linux: 107 };
const DEFAULT_UNIX_PATH_LIMIT = 103;

const PIPE_PREFIX = '\\\\.\\pipe\\latelier-agent-';

export interface EndpointInput {
  platform: NodeJS.Platform;
  userData: string;
  tmpdir: string;
  /** Distinguishes users on a shared temp dir; any string is fine. */
  uid: string | number;
  /** `n` lowercase hex characters from a CSPRNG. Injected so the paths are testable. */
  randomHex: (n: number) => string;
  /** `$XDG_RUNTIME_DIR`: a per-user 0700 directory the system provides. Preferred on Linux for the short-path fallback. */
  xdgRuntimeDir?: string | null;
}

export interface ResolvedEndpoint {
  kind: 'unix' | 'pipe';
  /** The socket path, or the pipe name. */
  path: string;
  /** A private directory the server must create before listening; null for a pipe. */
  dir: string | null;
  /** True when the short per-user fallback directory is used. */
  fallback: boolean;
}

/** `<userData>/agent`, the directory that holds the socket and the endpoint file. */
export function agentDir(userData: string): string {
  return path.join(userData, 'agent');
}

/** The one-line file naming the live endpoint, which the bridge reads. */
export function endpointFile(userData: string): string {
  return path.join(agentDir(userData), 'endpoint');
}

/**
 * Where the Agent socket lives (X27 §4.3). The preferred path is
 * `<userData>/agent/agent.sock`; when that would not fit a `sockaddr_un`, a
 * short per-user directory is used (`$XDG_RUNTIME_DIR/latelier` on Linux when
 * set, else `<tmpdir>/latelier-<uid>`), with a random file name so two
 * instances never share a path. Windows uses a named pipe with a fresh random
 * suffix on every start.
 */
export function resolveEndpoint(input: EndpointInput): ResolvedEndpoint {
  if (input.platform === 'win32') {
    // A fresh suffix on every start: the bridge reads the endpoint file each
    // time, so nothing is gained by keeping an old name, and a name that stays
    // the same across runs is one more thing another local user could learn.
    return { kind: 'pipe', path: `${PIPE_PREFIX}${input.randomHex(32)}`, dir: null, fallback: false };
  }
  const limit = UNIX_PATH_LIMIT[input.platform] ?? DEFAULT_UNIX_PATH_LIMIT;
  const dir = agentDir(input.userData);
  const preferred = path.join(dir, 'agent.sock');
  if (Buffer.byteLength(preferred) <= limit) {
    return { kind: 'unix', path: preferred, dir, fallback: false };
  }
  // A name under a shared temp dir is predictable, so another user could
  // squat it; `ensureOwnedPrivateDir` refuses such a directory. On Linux the
  // per-user runtime dir avoids the shared directory altogether.
  const runtimeDir =
    input.platform === 'linux' && input.xdgRuntimeDir && path.isAbsolute(input.xdgRuntimeDir)
      ? input.xdgRuntimeDir
      : null;
  const fallbackDir =
    runtimeDir === null ? path.join(input.tmpdir, `latelier-${input.uid}`) : path.join(runtimeDir, 'latelier');
  const fallback = path.join(fallbackDir, `agent-${input.randomHex(8)}.sock`);
  if (Buffer.byteLength(fallback) > limit) {
    throw new SystemError('INTERNAL', 'No Agent socket path fits the platform limit.', {
      limit,
      length: Buffer.byteLength(fallback),
    });
  }
  return { kind: 'unix', path: fallback, dir: fallbackDir, fallback: true };
}
