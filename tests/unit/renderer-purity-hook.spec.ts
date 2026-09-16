import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * `scripts/check-renderer-purity.mjs` is the PreToolUse hook that refuses an
 * edit introducing a main-process-only import into `src/**`. It had no test,
 * and a ReDoS fix to its import regex silently punched a hole in it: bounding
 * the import clause with `[^'"]*?` made the whole statement stop matching as
 * soon as the clause contained a quote, so
 *
 *     import {
 *       Foo, // don't remove
 *     } from 'mongodb';
 *
 * passed the guard. A check that fails open is worse than no check, because
 * nothing looks wrong. These cases pin both directions.
 *
 * Driven through the real script over stdin, exactly as the hook runs it —
 * asserting on the regex in isolation would not have caught the hole either,
 * since the regex "worked", just not on that input.
 */
const HOOK = join(dirname(createRequire(import.meta.url).resolve('../../package.json')), 'scripts/check-renderer-purity.mjs');

function check(filePath: string, content: string): 'allowed' | 'blocked' {
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath, content } }),
    encoding: 'utf8',
  });
  // The hook exits 2 to refuse; 0 to allow.
  return res.status === 0 ? 'allowed' : 'blocked';
}

describe('check-renderer-purity hook', () => {
  it.each([
    ['a plain default import', "import fs from 'fs';\n"],
    ['a named import', "import { readFileSync } from 'fs';\n"],
    ['a driver import', "import { MongoClient } from 'mongodb';\n"],
    ['an electron import', "import { ipcRenderer } from 'electron';\n"],
    ['a require call', "const db = require('better-sqlite3');\n"],
    ['a dynamic import', "const p = await import('path');\n"],
    // The regression. An apostrophe anywhere in the clause used to hide the
    // whole statement from the scan.
    ['an import whose clause contains a quote', "import {\n  readFileSync, // don't remove\n} from 'fs';\n"],
    ['an import with a quoted string in a block comment', "import {\n  x, /* the 'old' one */\n} from 'os';\n"],
    // A re-export pulls the module into the bundle just as an import does.
    ['a re-export', "export { join } from 'path';\n"],
    ['a side-effect import', "import 'node:fs';\n"],
  ])('refuses %s in src/', (_label, content) => {
    expect(check('src/pages/Thing.tsx', content)).toBe('blocked');
  });

  it.each([
    ['a react import', "import React from 'react';\n"],
    ['a stylesheet side-effect import', "import './thing.css';\n"],
    ['a relative import', "import { helper } from '../utils/helper';\n"],
    ['the typed IPC bridge', "import { api } from '../api/atelier';\n"],
    ['a shared types import', "import type { Connection } from '@shared/types';\n"],
  ])('allows %s in src/', (_label, content) => {
    expect(check('src/pages/Thing.tsx', content)).toBe('allowed');
  });

  it('allows the same forbidden imports outside src/', () => {
    expect(check('electron/services/Thing.ts', "import fs from 'fs';\n")).toBe('allowed');
    expect(check('scripts/thing.mjs', "const db = require('better-sqlite3');\n")).toBe('allowed');
  });

  it('does not hang on a pathological import clause', () => {
    // The `[\s\S]*?` the fix replaced backtracks super-linearly on this.
    const content = `import {${' '.repeat(40_000)}} from 'fs';\n`;
    const start = performance.now();
    expect(check('src/pages/Thing.tsx', content)).toBe('blocked');
    expect(performance.now() - start).toBeLessThan(5_000);
  });
});
