import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { agentDir, endpointFile, pipeSuffixFrom, resolveEndpoint } from '../../electron/agent/endpoint';

const hex = (n: number) => 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12'.slice(0, n);
const base = { tmpdir: '/var/tmp', uid: 501, randomHex: hex };

/** A user-data path whose `agent/agent.sock` is exactly `total` bytes long. */
function userDataFor(total: number): string {
  const tail = `${path.sep}agent${path.sep}agent.sock`;
  return '/u'.padEnd(total - tail.length, 'x');
}

describe('agentDir and endpointFile', () => {
  it('sit under userData/agent', () => {
    expect(agentDir('/data')).toBe(path.join('/data', 'agent'));
    expect(endpointFile('/data')).toBe(path.join('/data', 'agent', 'endpoint'));
  });
});

describe('resolveEndpoint on Unix', () => {
  it('uses agent/agent.sock under userData when it fits', () => {
    const r = resolveEndpoint({ ...base, platform: 'darwin', userData: '/data' });
    expect(r).toEqual({ kind: 'unix', path: '/data/agent/agent.sock', dir: '/data/agent', fallback: false });
  });

  it('allows 103 bytes on macOS and falls back at 104', () => {
    expect(resolveEndpoint({ ...base, platform: 'darwin', userData: userDataFor(103) }).fallback).toBe(false);
    const over = resolveEndpoint({ ...base, platform: 'darwin', userData: userDataFor(104) });
    expect(over).toEqual({
      kind: 'unix',
      path: '/var/tmp/latelier-501/agent-ab12cd34.sock',
      dir: '/var/tmp/latelier-501',
      fallback: true,
    });
  });

  it('allows 107 bytes on Linux and falls back at 108', () => {
    expect(resolveEndpoint({ ...base, platform: 'linux', userData: userDataFor(107) }).fallback).toBe(false);
    expect(resolveEndpoint({ ...base, platform: 'linux', userData: userDataFor(108) }).fallback).toBe(true);
  });

  it('counts bytes, not characters', () => {
    const wide = '/é'.repeat(40);
    const r = resolveEndpoint({ ...base, platform: 'darwin', userData: wide });
    expect(Buffer.byteLength(path.join(wide, 'agent', 'agent.sock'))).toBeGreaterThan(103);
    expect(r.fallback).toBe(true);
  });

  it('gives each fallback a random file name', () => {
    let n = 0;
    const a = resolveEndpoint({ ...base, platform: 'linux', userData: userDataFor(200), randomHex: () => `r${(n += 1)}` });
    const b = resolveEndpoint({ ...base, platform: 'linux', userData: userDataFor(200), randomHex: () => `r${(n += 1)}` });
    expect(a.path).not.toBe(b.path);
  });

  it('throws when even the fallback does not fit', () => {
    expect(() =>
      resolveEndpoint({ ...base, platform: 'linux', userData: userDataFor(200), tmpdir: `/${'t'.repeat(120)}` }),
    ).toThrow(/fits the platform limit/);
  });
});

describe('resolveEndpoint on Windows', () => {
  it('is a named pipe with a 32-hex suffix and no directory', () => {
    const r = resolveEndpoint({ ...base, platform: 'win32', userData: 'C:\\Users\\a', randomHex: () => 'f'.repeat(32) });
    expect(r).toEqual({ kind: 'pipe', path: `\\\\.\\pipe\\latelier-agent-${'f'.repeat(32)}`, dir: null, fallback: false });
  });

  it('asks the random source for 32 hex characters', () => {
    let asked = 0;
    resolveEndpoint({ ...base, platform: 'win32', userData: 'C:\\x', randomHex: (n) => ((asked = n), 'a'.repeat(n)) });
    expect(asked).toBe(32);
  });

  it('reuses a valid existing suffix and replaces an invalid one', () => {
    const keep = 'c'.repeat(32);
    expect(resolveEndpoint({ ...base, platform: 'win32', userData: 'C:\\x', existingPipeSuffix: keep }).path).toContain(keep);
    const fresh = resolveEndpoint({ ...base, platform: 'win32', userData: 'C:\\x', randomHex: () => 'd'.repeat(32), existingPipeSuffix: 'not-hex' });
    expect(fresh.path).toContain('d'.repeat(32));
    expect(
      resolveEndpoint({ ...base, platform: 'win32', userData: 'C:\\x', randomHex: () => 'd'.repeat(32), existingPipeSuffix: null }).path,
    ).toContain('d'.repeat(32));
  });
});

describe('pipeSuffixFrom', () => {
  const name = `\\\\.\\pipe\\latelier-agent-${'0a'.repeat(16)}`;

  it('reads the suffix back from the endpoint file, newline included', () => {
    expect(pipeSuffixFrom(`${name}\n`)).toBe('0a'.repeat(16));
  });

  it.each([
    ['a Unix path', '/data/agent/agent.sock\n'],
    ['an empty file', ''],
    ['a short suffix', '\\\\.\\pipe\\latelier-agent-abc'],
    ['uppercase hex', `\\\\.\\pipe\\latelier-agent-${'0A'.repeat(16)}`],
    ['a longer suffix', `${name}00`],
    ['another prefix', `\\\\.\\pipe\\other-${'0a'.repeat(16)}`],
  ])('returns null for %s', (_n, content) => {
    expect(pipeSuffixFrom(content)).toBeNull();
  });
});
