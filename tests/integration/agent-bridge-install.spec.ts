import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BridgeInstaller } from '../../electron/agent/bridgeInstall';
import type { Logger } from '../../electron/log';

const sha = (file: string) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

describe('BridgeInstaller', () => {
  let dir: string;
  let source: string;
  let installed: string;
  let log: { info: Mock<Logger['info']>; warn: Mock<Logger['warn']> };
  let installer: BridgeInstaller;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-install-'));
    source = path.join(dir, 'bundle', 'latelier-agent-bridge');
    installed = path.join(dir, 'user', 'bin', 'latelier-agent-bridge');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    log = { info: vi.fn<Logger['info']>(), warn: vi.fn<Logger['warn']>() };
    installer = new BridgeInstaller({ sourcePath: source, installedPath: installed, log });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeSource = (content: string) => fs.writeFileSync(source, content, { mode: 0o755 });
  const leftovers = () => fs.readdirSync(path.dirname(installed)).filter((n) => n !== path.basename(installed));

  it('copies the bundled bridge into a directory that does not exist yet, executable', () => {
    writeSource('bridge v1');

    expect(installer.ensureCopy()).toBe('copied');

    expect(fs.readFileSync(installed, 'utf8')).toBe('bridge v1');
    expect(installer.isInstalled()).toBe(true);
    if (process.platform !== 'win32') expect(fs.statSync(installed).mode & 0o777).toBe(0o700);
    expect(leftovers()).toEqual([]);
  });

  it('keeps the owner executable bit, and no group or other access, even when the bundled file lost it', () => {
    fs.writeFileSync(source, 'bridge v1', { mode: 0o644 });
    installer.ensureCopy();
    if (process.platform !== 'win32') expect(fs.statSync(installed).mode & 0o777).toBe(0o700);
  });

  it('does not touch the copy when it matches the bundled file', () => {
    writeSource('bridge v1');
    installer.ensureCopy();
    const before = fs.statSync(installed);

    expect(installer.ensureCopy()).toBe('unchanged');

    const after = fs.statSync(installed);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('copies again when the size differs', () => {
    writeSource('bridge v1');
    installer.ensureCopy();
    writeSource('bridge v1 and then some');

    expect(installer.ensureCopy()).toBe('copied');
    expect(fs.readFileSync(installed, 'utf8')).toBe('bridge v1 and then some');
  });

  it('copies again when only the content differs, at the same size', () => {
    writeSource('bridge v1');
    installer.ensureCopy();
    writeSource('bridge v2');
    expect(fs.statSync(source).size).toBe(fs.statSync(installed).size);
    expect(sha(source)).not.toBe(sha(installed));

    expect(installer.ensureCopy()).toBe('copied');
    expect(sha(installed)).toBe(sha(source));
  });

  it('replaces the copy through a rename, so a running client never sees half a file', () => {
    writeSource('bridge v1');
    installer.ensureCopy();
    const inode = fs.statSync(installed).ino;
    writeSource('bridge v2');
    const rename = vi.spyOn(fs, 'renameSync');

    installer.ensureCopy();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(path.dirname(rename.mock.calls[0]![0] as string)).toBe(path.dirname(installed));
    expect(rename.mock.calls[0]![1]).toBe(installed);
    // A new file took the path: the old inode was never written in place.
    expect(fs.statSync(installed).ino).not.toBe(inode);
    rename.mockRestore();
  });

  it('warns and does not throw when the bundled file is missing, and leaves nothing installed', () => {
    expect(installer.ensureCopy()).toBe('missing-source');

    expect(installer.isInstalled()).toBe(false);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![1]).toContain('not bundled');
    expect(fs.existsSync(path.dirname(installed))).toBe(false);
  });

  it('leaves an installed copy in place when the bundled file goes missing', () => {
    writeSource('bridge v1');
    installer.ensureCopy();
    fs.rmSync(source);

    expect(installer.ensureCopy()).toBe('missing-source');
    expect(fs.readFileSync(installed, 'utf8')).toBe('bridge v1');
  });

  it('warns, cleans its temp file and does not throw when the OS refuses the rename', () => {
    writeSource('bridge v1');
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    });

    expect(installer.ensureCopy()).toBe('failed');

    vi.restoreAllMocks();
    expect(installer.isInstalled()).toBe(false);
    expect(leftovers()).toEqual([]);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn.mock.calls[0]![2]).toMatchObject({ errCode: 'EPERM' });
  });

  it('removes the copy and says whether it was there', () => {
    writeSource('bridge v1');
    installer.ensureCopy();

    expect(installer.remove()).toBe(true);
    expect(installer.isInstalled()).toBe(false);
    expect(installer.remove()).toBe(false);
  });

  it('reports the installed path it was given', () => {
    expect(installer.installedPath).toBe(installed);
  });
});
