import { describe, it, expect } from 'vitest';
import { configSnippet, SNIPPET_CLIENTS } from '../../electron/agent/snippets';
import { generateToken } from '../../electron/agent/token';

const BRIDGE = "/Users/me/Library/Application Support/L'Atelier/bin/latelier-agent-bridge";

describe('configSnippet', () => {
  const token = generateToken();

  it('names the three clients in the order the dialog offers them', () => {
    expect(SNIPPET_CLIENTS.map((c) => [c.client, c.label])).toEqual([
      ['claude-code', 'Claude Code'],
      ['claude-desktop', 'Claude Desktop'],
      ['cursor', 'Cursor'],
    ]);
  });

  it('writes the bridge path, no args and the token in the environment', () => {
    const parsed = JSON.parse(configSnippet('cursor', BRIDGE, token));
    expect(parsed).toEqual({
      mcpServers: { latelier: { command: BRIDGE, args: [], env: { LATELIER_AGENT_TOKEN: token } } },
    });
  });

  it('adds the stdio transport for Claude Code only', () => {
    expect(JSON.parse(configSnippet('claude-code', BRIDGE, token)).mcpServers.latelier.type).toBe('stdio');
    expect(JSON.parse(configSnippet('claude-desktop', BRIDGE, token)).mcpServers.latelier).not.toHaveProperty('type');
    expect(JSON.parse(configSnippet('cursor', BRIDGE, token)).mcpServers.latelier).not.toHaveProperty('type');
  });

  it('is pretty-printed JSON with two-space indents', () => {
    const text = configSnippet('cursor', BRIDGE, token);
    expect(text.startsWith('{\n  "mcpServers": {\n    "latelier": {')).toBe(true);
  });

  it('escapes a Windows path so the JSON still parses back to it', () => {
    const win = "C:\\Users\\me\\AppData\\Local\\L'Atelier\\bin\\latelier-agent-bridge.exe";
    expect(JSON.parse(configSnippet('claude-desktop', win, token)).mcpServers.latelier.command).toBe(win);
  });

  it.each(['', 'has space', 'quote"inject', 'line\nbreak', 'ünï', 'a'.repeat(257)])(
    'refuses to write a configuration for the malformed token %j',
    (bad) => {
      expect(() => configSnippet('cursor', BRIDGE, bad)).toThrow('malformed Agent Token');
    },
  );

  it('never puts the token anywhere but the environment value', () => {
    const text = configSnippet('claude-code', BRIDGE, token);
    expect(text.split(token)).toHaveLength(2);
  });
});
