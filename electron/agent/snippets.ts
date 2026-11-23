import { TOKEN_RE } from './token.ts';

export type SnippetClient = 'claude-code-cli' | 'claude-code' | 'claude-desktop' | 'cursor';

/** The MCP server name every snippet registers, and the one `claude mcp` commands refer to. */
export const MCP_SERVER_NAME = 'latelier';

/** The token placeholder in the command Settings shows. Inside the token class, so it never reads as shell syntax. */
export const TOKEN_PLACEHOLDER = 'YOUR_TOKEN';

/** What the token dialog offers, in order: the button text and what the note says once it copied. */
export const SNIPPET_CLIENTS: ReadonlyArray<{ client: SnippetClient; button: string; copied: string }> = [
  {
    client: 'claude-code-cli',
    button: 'Copy Claude Code command',
    copied: 'Claude Code command copied. Paste it into a terminal and run it, then check with: claude mcp list',
  },
  { client: 'claude-code', button: 'Copy for Claude Code (JSON)', copied: 'Configuration copied for Claude Code (JSON).' },
  { client: 'claude-desktop', button: 'Copy for Claude Desktop', copied: 'Configuration copied for Claude Desktop.' },
  { client: 'cursor', button: 'Copy for Cursor', copied: 'Configuration copied for Cursor.' },
];

/** Characters a POSIX shell takes literally in a bare word. */
const BARE_WORD = /^[A-Za-z0-9_./-]+$/;

/**
 * The bridge path as one shell word. The macOS path holds a space and an
 * apostrophe ("Application Support/L'Atelier"), so it is double-quoted, with
 * the four characters a POSIX shell still expands inside double quotes
 * escaped. Windows paths cannot contain `"`, and cmd and PowerShell both take
 * a double-quoted path as one word without escapes.
 */
export function shellQuotePath(path: string, platform: NodeJS.Platform): string {
  if (platform === 'win32') return `"${path}"`;
  if (BARE_WORD.test(path)) return path;
  return `"${path.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;
}

/**
 * The `claude mcp add` command. The name comes first: `-e` takes several
 * values, so anything after it up to `--` would be read as another variable.
 * `--scope user` makes the server available in every project.
 */
function claudeCodeCommand(bridgePath: string, token: string, platform: NodeJS.Platform): string {
  return `claude mcp add ${MCP_SERVER_NAME} --scope user -e LATELIER_AGENT_TOKEN=${token} -- ${shellQuotePath(bridgePath, platform)}`;
}

/** The command Settings shows as an example. It carries the placeholder, never a token. */
export function claudeCodeCommandTemplate(bridgePath: string, platform: NodeJS.Platform): string {
  return claudeCodeCommand(bridgePath, TOKEN_PLACEHOLDER, platform);
}

/**
 * The ready-to-paste MCP client configuration (X27 §5.2): the absolute path of
 * the bridge's per-user copy, no args, and the token in the environment. For
 * Claude Code it is either the `claude mcp add` command or the JSON, which
 * also names the transport.
 */
export function configSnippet(client: SnippetClient, bridgePath: string, token: string, platform: NodeJS.Platform): string {
  // The bridge refuses any other character, so a token outside the class could never connect: say so now.
  if (!TOKEN_RE.test(token)) throw new Error('refusing to write a configuration for a malformed Agent Token');
  if (client === 'claude-code-cli') return claudeCodeCommand(bridgePath, token, platform);
  const server = {
    ...(client === 'claude-code' ? { type: 'stdio' } : {}),
    command: bridgePath,
    args: [] as string[],
    env: { LATELIER_AGENT_TOKEN: token },
  };
  return JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2);
}
