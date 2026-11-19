import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureOwnedPrivateDir, type OwnedDirOps } from '../../electron/agent/ownedDir';

const posix = process.platform !== 'win32';
const uid = posix ? process.getuid!() : 0;

describe.runIf(posix)('ensureOwnedPrivateDir', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'owned-dir-'));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const mode = (p: string) => fs.statSync(p).mode & 0o777;

  it('creates a missing directory with mode 0700', () => {
    const dir = path.join(root, 'new');
    ensureOwnedPrivateDir(dir, uid);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    expect(mode(dir)).toBe(0o700);
  });

  it('accepts an existing 0700 directory we own and leaves its contents', () => {
    const dir = path.join(root, 'ok');
    fs.mkdirSync(dir, { mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'keep'), 'x');
    ensureOwnedPrivateDir(dir, uid);
    expect(fs.readFileSync(path.join(dir, 'keep'), 'utf8')).toBe('x');
  });

  it('tightens a looser mode on a directory we own', () => {
    const dir = path.join(root, 'loose');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    ensureOwnedPrivateDir(dir, uid);
    expect(mode(dir)).toBe(0o700);
  });

  it('refuses a symbolic link, even one that points at a directory we own', () => {
    const target = path.join(root, 'target');
    fs.mkdirSync(target, { mode: 0o700 });
    const link = path.join(root, 'link');
    fs.symlinkSync(target, link);
    expect(() => ensureOwnedPrivateDir(link, uid)).toThrow(/symbolic link/);
    expect(mode(target)).toBe(0o700);
  });

  it('refuses a dangling symbolic link and does not create through it', () => {
    const link = path.join(root, 'dangling');
    fs.symlinkSync(path.join(root, 'nowhere'), link);
    expect(() => ensureOwnedPrivateDir(link, uid)).toThrow(/symbolic link/);
    expect(fs.existsSync(path.join(root, 'nowhere'))).toBe(false);
  });

  it('refuses a regular file at the path', () => {
    const file = path.join(root, 'file');
    fs.writeFileSync(file, '');
    expect(() => ensureOwnedPrivateDir(file, uid)).toThrow(/not a directory/);
  });

  it('refuses a directory owned by another user, and leaves its mode alone', () => {
    const dir = path.join(root, 'theirs');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    expect(() => ensureOwnedPrivateDir(dir, uid + 1)).toThrow(/owned by another user/);
    expect(mode(dir)).toBe(0o755);
  });

  it('names the directory and the owner in the error details', () => {
    const dir = path.join(root, 'theirs');
    fs.mkdirSync(dir, { mode: 0o700 });
    try {
      ensureOwnedPrivateDir(dir, uid + 1);
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ code: 'INTERNAL', details: { dir, owner: uid } });
      expect((err as Error).message).toContain(dir);
    }
  });

  it('refuses when the mode cannot be set to 0700', () => {
    const dir = path.join(root, 'stuck');
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o755);
    const ops: OwnedDirOps = { ...fs, fchmodSync: () => undefined };
    expect(() => ensureOwnedPrivateDir(dir, uid, ops)).toThrow(/mode could not be set/);
  });

  it('refuses when the path is swapped between the check and the open', () => {
    const dir = path.join(root, 'swap');
    fs.mkdirSync(dir, { mode: 0o700 });
    const ops: OwnedDirOps = {
      ...fs,
      fstatSync: (fd) => {
        const st = fs.fstatSync(fd);
        return Object.assign(Object.create(Object.getPrototypeOf(st) as object), st, { ino: st.ino + 1 }) as fs.Stats;
      },
    };
    expect(() => ensureOwnedPrivateDir(dir, uid, ops)).toThrow(/changed while it was checked/);
  });

  it('refuses when the descriptor is not a directory', () => {
    const dir = path.join(root, 'notdir');
    fs.mkdirSync(dir, { mode: 0o700 });
    const ops: OwnedDirOps = {
      ...fs,
      fstatSync: (fd) => {
        const st = fs.fstatSync(fd);
        return Object.assign(Object.create(Object.getPrototypeOf(st) as object), st, { isDirectory: () => false }) as fs.Stats;
      },
    };
    expect(() => ensureOwnedPrivateDir(dir, uid, ops)).toThrow(/not a directory/);
  });

  it('refuses when the directory cannot be opened without following links', () => {
    const dir = path.join(root, 'noopen');
    fs.mkdirSync(dir, { mode: 0o700 });
    const ops: OwnedDirOps = {
      ...fs,
      openSync: () => {
        throw Object.assign(new Error('boom'), { code: 'ELOOP' });
      },
    };
    expect(() => ensureOwnedPrivateDir(dir, uid, ops)).toThrow(/could not be opened/);
  });

  it('rethrows a mkdir failure other than "exists"', () => {
    const ops: OwnedDirOps = {
      ...fs,
      mkdirSync: () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      },
    };
    expect(() => ensureOwnedPrivateDir(path.join(root, 'x'), uid, ops)).toThrow(/denied/);
  });

  it('closes the descriptor on success and on refusal', () => {
    const dir = path.join(root, 'fd');
    fs.mkdirSync(dir, { mode: 0o700 });
    const closed: number[] = [];
    const ops: OwnedDirOps = { ...fs, closeSync: (fd) => (closed.push(fd), fs.closeSync(fd)) };
    ensureOwnedPrivateDir(dir, uid, ops);
    expect(() => ensureOwnedPrivateDir(dir, uid + 1, ops)).toThrow();
    expect(closed).toHaveLength(2);
  });
});
