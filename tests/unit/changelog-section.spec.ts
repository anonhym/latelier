import { describe, it, expect, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MD = `# Changelog

## [Unreleased]

## [0.20.0] — 2026-11-13

### Changed

- **A.** text

## [0.19.1] — 2026-11-12

### Fixed

- b
`;

const dir = mkdtempSync(join(tmpdir(), 'changelog-section-'));
const file = join(dir, 'CHANGELOG.md');
writeFileSync(file, MD);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(...args: string[]) {
  return spawnSync('node', ['scripts/changelog-section.mjs', ...args], { encoding: 'utf8' });
}

describe('scripts/changelog-section.mjs', () => {
  it('prints the body between the version heading and the next heading', () => {
    const out = run('0.20.0', '--file', file);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('### Changed\n\n- **A.** text\n');
  });

  it('--check prints nothing and exits 0 when the section exists', () => {
    const out = run('0.19.1', '--check', '--file', file);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('');
  });

  it('exits 1 naming the heading when the version has no section, with or without --check', () => {
    for (const extra of [[], ['--check']]) {
      const out = run('9.9.9', ...extra, '--file', file);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain('## [9.9.9]');
    }
  });

  it('exits 1 on an empty section and 2 without a version', () => {
    expect(run('Unreleased', '--file', file).status).toBe(1);
    expect(run('--file', file).status).toBe(2);
  });

  it('finds a section for the current package version in the real CHANGELOG.md', () => {
    const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(run(version, '--check').status).toBe(0);
  });
});
