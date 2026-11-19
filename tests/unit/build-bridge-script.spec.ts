import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';

/**
 * `scripts/build-bridge.mjs` runs here with an empty PATH, so cargo cannot be
 * found whatever the machine has: the only thing under test is what the script
 * does about a missing toolchain, which is the one decision that differs
 * between a contributor's machine and CI.
 */
function run(args: string[], env: Record<string, string>) {
  // Not process.env: a CI runner's own `CI` must not leak into a case that expects it unset.
  return spawnSync(process.execPath, ['scripts/build-bridge.mjs', ...args], { encoding: 'utf8', env: { PATH: '', ...env } });
}

describe('scripts/build-bridge.mjs without cargo', () => {
  it('only warns on a developer machine, so the app still builds', () => {
    const r = run([], {});
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('cargo is not on PATH');
    expect(r.stderr).toContain('WARNING');
  });

  it.each(['', '0', 'false', 'FALSE'])('treats CI=%j as not CI', (ci) => {
    expect(run([], { CI: ci }).status).toBe(0);
  });

  it.each(['1', 'true', 'TRUE', 'yes'])('fails on CI (CI=%s): a package without the bridge must never ship', (ci) => {
    const r = run([], { CI: ci });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot skip it');
  });
});

describe('scripts/build-bridge.mjs arguments', () => {
  it.each([['--targets', 'beos-x64'], ['--targets', 'mac-arm64,nope'], ['--targets', ''], ['--targets']])(
    'refuses %j with exit 2 before it looks for cargo',
    (...args) => {
      const r = run(args, { CI: '1' });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/--targets|unknown bridge target/);
    },
  );

  it('names the valid targets when one is unknown', () => {
    const r = run(['--targets', 'beos-x64'], {});
    expect(r.stderr).toContain('mac-arm64, mac-x64, win-x64');
  });
});
