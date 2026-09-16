#!/usr/bin/env node
/**
 * check-renderer-purity.mjs
 *
 * Claude Code PreToolUse hook: blocks Edit/Write operations that would
 * introduce a forbidden import into `src/**` (the renderer bundle).
 *
 * The renderer must never import from:
 *   - `electron` or `electron/**`
 *   - `mongodb`
 *   - `better-sqlite3`
 *   - `ssh2`
 *   - Node built-ins: `fs`, `path`, `os`, `crypto`, `child_process`, `stream`
 *     (OK in `electron/**` and `scripts/**`, never in `src/**`)
 *
 * Reads the hook payload on stdin, exits 0 to allow, 2 (block) with a
 * message on stderr to refuse.
 *
 * Hook payload shape (PreToolUse):
 *   { tool_name: "Edit"|"Write"|"MultiEdit", tool_input: { file_path, new_string?, content? } }
 */
import { readFileSync } from 'node:fs';

// bson is deliberately NOT in this list — the renderer uses it for EJSON helpers.
const FORBIDDEN = ['electron', 'mongodb', 'better-sqlite3', 'ssh2'];

const FORBIDDEN_NODE_BUILTINS = [
  'fs',
  'node:fs',
  'path',
  'node:path',
  'os',
  'node:os',
  'node:crypto',
  'child_process',
  'node:child_process',
];

function readStdin() {
  return readFileSync(0, 'utf8');
}

function extractImports(source) {
  const out = new Set();
  // `[^'"]*?` rather than `[\s\S]*?`: an import clause never contains a quote,
  // so bounding it there stops the lazy run from scanning past the `from`
  // string it is supposed to stop before (S8786).
  const re = /(?:^|\n)\s*import\s+[^'"]*?\s*from\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(source))) out.add(m[1]);
  const reDyn = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reDyn.exec(source))) out.add(m[1]);
  const reReq = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = reReq.exec(source))) out.add(m[1]);
  return out;
}

function isInRenderer(filePath) {
  if (!filePath) return false;
  return /(?:^|\/)src\//.test(filePath) && /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath);
}

function gatherContent(toolInput) {
  const parts = [];
  if (typeof toolInput.content === 'string') parts.push(toolInput.content);
  if (typeof toolInput.new_string === 'string') parts.push(toolInput.new_string);
  if (Array.isArray(toolInput.edits)) {
    for (const e of toolInput.edits) {
      if (typeof e.new_string === 'string') parts.push(e.new_string);
    }
  }
  return parts.join('\n');
}

let payload;
try {
  payload = JSON.parse(readStdin());
} catch {
  // No payload → nothing to validate.
  process.exit(0);
}

const toolName = payload.tool_name ?? '';
if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) process.exit(0);

const toolInput = payload.tool_input ?? {};
const filePath = toolInput.file_path ?? '';
if (!isInRenderer(filePath)) process.exit(0);

// Allow imports inside `src/__mocks__/**` or tests (those don't ship).
if (/\/__mocks__\//.test(filePath)) process.exit(0);

const content = gatherContent(toolInput);
if (!content) process.exit(0);

const imports = extractImports(content);
const violations = [];
for (const imp of imports) {
  const bare = imp.split('/')[0];
  if (FORBIDDEN.includes(bare) || FORBIDDEN.includes(imp)) {
    violations.push(imp);
    continue;
  }
  if (FORBIDDEN_NODE_BUILTINS.includes(imp)) {
    violations.push(imp);
    continue;
  }
  // Block any import that reaches into /electron/
  if (imp.includes('/electron/') || imp.startsWith('../electron') || imp.startsWith('electron/')) {
    violations.push(imp);
  }
}

if (violations.length === 0) process.exit(0);

process.stderr.write(
  `\nRefused: renderer purity violation.\n` +
    `File: ${filePath}\n` +
    `Forbidden imports: ${violations.join(', ')}\n\n` +
    `The renderer bundle must never import Node-only or main-process modules.\n` +
    `If you need SQLite / Mongo / filesystem access, go through an IPC channel\n` +
    `(see electron/ipc/handlers/ and shared/ipc.ts). See F01 spec §1.\n`,
);
process.exit(2);
