import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '../log.ts';

export type BridgeCopyOutcome = 'copied' | 'unchanged' | 'missing-source' | 'failed';

export interface BridgeInstallerDeps {
  /** The bridge that ships with this build. May be absent in development without a Rust toolchain. */
  sourcePath: string;
  /** The fixed per-user copy the Agent client configuration points at. */
  installedPath: string;
  log: Pick<Logger, 'info' | 'warn'>;
}

/** What `AgentAccessService` needs of the installer; a test stands in for it. */
export interface BridgeHandle {
  readonly installedPath: string;
  isInstalled(): boolean;
  ensureCopy(): BridgeCopyOutcome;
  remove(): boolean;
}

function sha256(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sameContent(a: string, b: string): boolean {
  if (fs.statSync(a).size !== fs.statSync(b).size) return false;
  return sha256(a) === sha256(b);
}

/**
 * Keeps one copy of the Agent Bridge at a path that never changes (X27 §15
 * question 5). It copies when the bundled file's size or SHA-256 differs from
 * the copy, through a temporary file in the same directory and a rename, so a
 * client that starts the bridge mid-copy never runs half a file.
 *
 * Nothing here throws into the caller: a build without a bridge (development
 * with no Rust toolchain) or a copy the OS refuses (on Windows, renaming over
 * a bridge a client is running) is logged, and `isInstalled()` says what is
 * actually on disk.
 */
export class BridgeInstaller implements BridgeHandle {
  private deps: BridgeInstallerDeps;

  constructor(deps: BridgeInstallerDeps) {
    this.deps = deps;
  }

  get installedPath(): string {
    return this.deps.installedPath;
  }

  isInstalled(): boolean {
    try {
      return fs.statSync(this.deps.installedPath).isFile();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  ensureCopy(): BridgeCopyOutcome {
    const { sourcePath, installedPath, log } = this.deps;
    if (!fs.existsSync(sourcePath)) {
      log.warn('agent', 'the Agent Bridge is not bundled with this build; nothing to install', { sourcePath });
      return 'missing-source';
    }
    const tmp = path.join(path.dirname(installedPath), `.${path.basename(installedPath)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      if (this.isInstalled() && sameContent(sourcePath, installedPath)) return 'unchanged';
      fs.mkdirSync(path.dirname(installedPath), { recursive: true });
      fs.copyFileSync(sourcePath, tmp);
      // Owner-only: the per-user copy is only ever run by the user it belongs to.
      fs.chmodSync(tmp, 0o700);
      fs.renameSync(tmp, installedPath);
      log.info('agent', 'installed the Agent Bridge', { installedPath });
      return 'copied';
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      log.warn('agent', 'could not install the Agent Bridge', {
        installedPath,
        errName: err instanceof Error ? err.name : typeof err,
        errCode: (err as NodeJS.ErrnoException).code,
      });
      return 'failed';
    }
  }

  /** Deletes the per-user copy. Returns whether a file was there. */
  remove(): boolean {
    if (!this.isInstalled()) return false;
    fs.rmSync(this.deps.installedPath, { force: true });
    return true;
  }
}
