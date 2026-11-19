import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Text-level guard, like electron-builder-fuses.spec.ts: the real proof is the
// release workflow's check of the packaged bundle, but this catches the config
// being edited or dropped early.
const config = readFileSync(resolve(__dirname, '../../electron-builder.yml'), 'utf8');

describe('electron-builder.yml Agent Bridge', () => {
  it('bundles build/bridge/<os>-<arch> into Resources/bin, outside the asar', () => {
    expect(config).toMatch(/^extraResources:\s*$/m);
    expect(config).toMatch(/^ {2}- from: build\/bridge\/\$\{os\}-\$\{arch\}\s*$/m);
    expect(config).toMatch(/^ {4}to: bin\s*$/m);
    expect(config).toMatch(/^ {6}- latelier-agent-bridge\*\s*$/m);
  });

  it('lists the bridge under mac.binaries so it is signed with the hardened runtime', () => {
    expect(config).toMatch(/^mac:\s*$/m);
    expect(config).toMatch(/^ {2}binaries:\s*\n(?: {2,}#.*\n)* {4}- Contents\/Resources\/bin\/latelier-agent-bridge\s*$/m);
  });
});
