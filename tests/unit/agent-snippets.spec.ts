import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  claudeCodeCommandTemplate,
  configSnippet,
  shellQuotePath,
  SNIPPET_CLIENTS,
  TOKEN_PLACEHOLDER,
} from '../../electron/agent/snippets';
import { generateToken, TOKEN_RE } from '../../electron/agent/token';

const BRIDGE = "/Users/me/Library/Application Support/L'Atelier/bin/latelier-agent-bridge";
const WIN = "C:\\Users\\me\\AppData\\Local\\L'Atelier\\bin\\latelier-agent-bridge.exe";

/** What a real POSIX shell makes of a word: the proof a quoting claim holds. */
function shellWords(cmdTail: string): string[] {
  const out = execFileSync('/bin/sh', ['-c', `for a in ${cmdTail}; do printf '%s\\0' "$a"; done`], { encoding: 'utf8' });
  return out.split('\0').slice(0, -1);
}

describe('configSnippet', () => {
  const token = generateToken();

  it('offers the Claude Code command first, then the three JSON configurations, each with its own note', () => {
    expect(SNIPPET_CLIENTS.map((c) => [c.client, c.button])).toEqual([
      ['claude-code-cli', 'Copy Claude Code command'],
      ['claude-code', 'Copy for Claude Code (JSON)'],
      ['claude-desktop', 'Copy for Claude Desktop'],
      ['cursor', 'Copy for Cursor'],
    ]);
    expect(SNIPPET_CLIENTS[0]!.copied).toBe(
      'Claude Code command copied. Paste it into a terminal and run it, then check with: claude mcp list',
    );
    expect(SNIPPET_CLIENTS.slice(1).map((c) => c.copied)).toEqual([
      'Configuration copied for Claude Code (JSON).',
      'Configuration copied for Claude Desktop.',
      'Configuration copied for Cursor.',
    ]);
  });

  it('writes the bridge path, no args and the token in the environment', () => {
    const parsed = JSON.parse(configSnippet('cursor', BRIDGE, token, 'darwin'));
    expect(parsed).toEqual({
      mcpServers: { latelier: { command: BRIDGE, args: [], env: { LATELIER_AGENT_TOKEN: token } } },
    });
  });

  it('adds the stdio transport for Claude Code JSON only', () => {
    expect(JSON.parse(configSnippet('claude-code', BRIDGE, token, 'darwin')).mcpServers.latelier.type).toBe('stdio');
    expect(JSON.parse(configSnippet('claude-desktop', BRIDGE, token, 'darwin')).mcpServers.latelier).not.toHaveProperty('type');
    expect(JSON.parse(configSnippet('cursor', BRIDGE, token, 'darwin')).mcpServers.latelier).not.toHaveProperty('type');
  });

  it('is pretty-printed JSON with two-space indents', () => {
    const text = configSnippet('cursor', BRIDGE, token, 'darwin');
    expect(text.startsWith('{\n  "mcpServers": {\n    "latelier": {')).toBe(true);
  });

  it('escapes a Windows path so the JSON still parses back to it', () => {
    expect(JSON.parse(configSnippet('claude-desktop', WIN, token, 'win32')).mcpServers.latelier.command).toBe(WIN);
  });

  it.each(['', 'has space', 'quote"inject', 'line\nbreak', 'ünï', 'a'.repeat(257)])(
    'refuses to write a configuration for the malformed token %j',
    (bad) => {
      expect(() => configSnippet('cursor', BRIDGE, bad, 'darwin')).toThrow('malformed Agent Token');
      expect(() => configSnippet('claude-code-cli', BRIDGE, bad, 'darwin')).toThrow('malformed Agent Token');
    },
  );

  it('never puts the token anywhere but the environment value', () => {
    expect(configSnippet('claude-code', BRIDGE, token, 'darwin').split(token)).toHaveLength(2);
    expect(configSnippet('claude-code-cli', BRIDGE, token, 'darwin').split(token)).toHaveLength(2);
  });
});

describe('the Claude Code command', () => {
  const token = generateToken();

  it('names the server before -e, scopes it to the user, and ends with the quoted bridge path', () => {
    expect(configSnippet('claude-code-cli', BRIDGE, token, 'darwin')).toBe(
      `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=${token} -- "${BRIDGE}"`,
    );
  });

  it('a POSIX shell reads it as exactly the words claude mcp add expects', () => {
    const cmd = configSnippet('claude-code-cli', BRIDGE, token, 'linux');
    expect(shellWords(cmd)).toEqual(['claude', 'mcp', 'add', 'latelier', '--scope', 'user', '-e', `LATELIER_AGENT_TOKEN=${token}`, '--', BRIDGE]);
  });

  it('double-quotes the Windows path without escaping its backslashes', () => {
    expect(configSnippet('claude-code-cli', WIN, token, 'win32')).toBe(
      `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=${token} -- "${WIN}"`,
    );
  });

  it('the Settings template carries the placeholder and never a token', () => {
    expect(TOKEN_RE.test(TOKEN_PLACEHOLDER)).toBe(true);
    expect(claudeCodeCommandTemplate(BRIDGE, 'darwin')).toBe(
      `claude mcp add latelier --scope user -e LATELIER_AGENT_TOKEN=YOUR_TOKEN -- "${BRIDGE}"`,
    );
  });
});

describe('shellQuotePath', () => {
  it('leaves a path of plain characters bare', () => {
    expect(shellQuotePath('/home/me/.local/share/latelier/bin/latelier-agent-bridge', 'linux')).toBe(
      '/home/me/.local/share/latelier/bin/latelier-agent-bridge',
    );
  });

  it('quotes a path with a space or an apostrophe', () => {
    expect(shellQuotePath('/a b/c', 'darwin')).toBe('"/a b/c"');
    expect(shellQuotePath("/a'b", 'darwin')).toBe('"/a\'b"');
  });

  it('escapes the four characters a shell expands inside double quotes', () => {
    expect(shellQuotePath('/a\\b"c$d`e', 'linux')).toBe('"/a\\\\b\\"c\\$d\\`e"');
  });

  it.each([
    BRIDGE,
    '/home/me/.local/share/L\'Atelier/bin/latelier-agent-bridge',
    '/tmp/$HOME/`id`/a"b\\c d',
    '/tmp/*?[x]~/{a,b};&|<>()!#',
    '/plain/path',
  ])('a POSIX shell reads %j back as the same single word', (path) => {
    expect(shellWords(shellQuotePath(path, 'linux'))).toEqual([path]);
  });

  it('always double-quotes on Windows', () => {
    expect(shellQuotePath('C:\\plain', 'win32')).toBe('"C:\\plain"');
    expect(shellQuotePath(WIN, 'win32')).toBe(`"${WIN}"`);
  });
});
