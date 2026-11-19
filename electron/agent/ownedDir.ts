import fs from 'node:fs';
import { SystemError } from '../errors.ts';

/** The fs calls the check makes, so a test can stand in for an owner it cannot become. */
export interface OwnedDirOps {
  mkdirSync: (dir: string, options: { mode: number }) => unknown;
  lstatSync: (dir: string) => fs.Stats;
  openSync: (dir: string, flags: number) => number;
  fstatSync: (fd: number) => fs.Stats;
  fchmodSync: (fd: number, mode: number) => void;
  closeSync: (fd: number) => void;
}

const REAL_OPS: OwnedDirOps = fs;

function refuse(dir: string, why: string, details?: Record<string, unknown>): SystemError {
  return new SystemError('INTERNAL', `Refusing to use ${dir} for the Agent socket: ${why}.`, { dir, ...details });
}

/**
 * Makes sure `dir` is a real directory owned by `uid` with mode 0700, creating
 * it when absent. For a directory under a shared temp dir, where another user
 * may have created the predictable name first (or planted a symlink at it): a
 * symlink, a non-directory or a directory owned by someone else is refused,
 * never adopted. A directory we own with a looser mode is tightened. The
 * ownership and mode checks run on a descriptor opened without following
 * symlinks, so the path cannot be swapped between the check and the chmod.
 */
export function ensureOwnedPrivateDir(dir: string, uid: number, ops: OwnedDirOps = REAL_OPS): void {
  try {
    ops.mkdirSync(dir, { mode: 0o700 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const seen = ops.lstatSync(dir);
  if (seen.isSymbolicLink()) throw refuse(dir, 'it is a symbolic link');
  if (!seen.isDirectory()) throw refuse(dir, 'it is not a directory');

  let fd: number;
  try {
    fd = ops.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  } catch (err) {
    throw refuse(dir, 'it could not be opened as a plain directory', { errCode: (err as NodeJS.ErrnoException).code });
  }
  try {
    const st = ops.fstatSync(fd);
    if (!st.isDirectory()) throw refuse(dir, 'it is not a directory');
    if (st.ino !== seen.ino || st.dev !== seen.dev) throw refuse(dir, 'it changed while it was checked');
    if (st.uid !== uid) throw refuse(dir, 'it is owned by another user', { owner: st.uid });
    if ((st.mode & 0o777) !== 0o700) {
      ops.fchmodSync(fd, 0o700);
      const after = ops.fstatSync(fd);
      if ((after.mode & 0o777) !== 0o700) throw refuse(dir, 'its mode could not be set to 0700', { mode: after.mode & 0o777 });
    }
  } finally {
    ops.closeSync(fd);
  }
}
