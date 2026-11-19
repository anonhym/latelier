import path from 'node:path';
import { SystemError } from '../errors.ts';

/** Longest Unix socket path in bytes: `sun_path` less its terminator on macOS (104) and Linux (108). */
const UNIX_PATH_LIMIT: Record<string, number> = { darwin: 103, linux: 107 };
const DEFAULT_UNIX_PATH_LIMIT = 103;

const PIPE_PREFIX = '\\\\.\\pipe\\latelier-agent-';
const PIPE_SUFFIX_RE = /^[0-9a-f]{32}$/;

export interface EndpointInput {
  platform: NodeJS.Platform;
  userData: string;
  tmpdir: string;
  /** Distinguishes users on a shared temp dir; any string is fine. */
  uid: string | number;
  /** `n` lowercase hex characters from a CSPRNG. Injected so the paths are testable. */
  randomHex: (n: number) => string;
  /** The Windows pipe suffix kept from a previous run, reused while the endpoint file exists. */
  existingPipeSuffix?: string | null;
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

/** The suffix of a pipe name read back from the endpoint file, or null when it is not one of ours. */
export function pipeSuffixFrom(content: string): string | null {
  const line = content.trim();
  if (!line.startsWith(PIPE_PREFIX)) return null;
  const suffix = line.slice(PIPE_PREFIX.length);
  return PIPE_SUFFIX_RE.test(suffix) ? suffix : null;
}

/**
 * Where the Agent socket lives (X27 §4.3). The preferred path is
 * `<userData>/agent/agent.sock`; when that would not fit a `sockaddr_un`, a
 * short per-user directory under the temp dir is used, with a random file name
 * so two instances never share a path. Windows uses a named pipe whose random
 * suffix is stable across restarts.
 */
export function resolveEndpoint(input: EndpointInput): ResolvedEndpoint {
  if (input.platform === 'win32') {
    const suffix =
      input.existingPipeSuffix && PIPE_SUFFIX_RE.test(input.existingPipeSuffix)
        ? input.existingPipeSuffix
        : input.randomHex(32);
    return { kind: 'pipe', path: `${PIPE_PREFIX}${suffix}`, dir: null, fallback: false };
  }
  const limit = UNIX_PATH_LIMIT[input.platform] ?? DEFAULT_UNIX_PATH_LIMIT;
  const dir = agentDir(input.userData);
  const preferred = path.join(dir, 'agent.sock');
  if (Buffer.byteLength(preferred) <= limit) {
    return { kind: 'unix', path: preferred, dir, fallback: false };
  }
  const fallbackDir = path.join(input.tmpdir, `latelier-${input.uid}`);
  const fallback = path.join(fallbackDir, `agent-${input.randomHex(8)}.sock`);
  if (Buffer.byteLength(fallback) > limit) {
    throw new SystemError('INTERNAL', 'No Agent socket path fits the platform limit.', {
      limit,
      length: Buffer.byteLength(fallback),
    });
  }
  return { kind: 'unix', path: fallback, dir: fallbackDir, fallback: true };
}
