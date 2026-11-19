import { TOKEN_RE } from './token.ts';

export type SnippetClient = 'claude-code' | 'claude-desktop' | 'cursor';

/** Display names, in the order the token dialog offers them. */
export const SNIPPET_CLIENTS: ReadonlyArray<{ client: SnippetClient; label: string }> = [
  { client: 'claude-code', label: 'Claude Code' },
  { client: 'claude-desktop', label: 'Claude Desktop' },
  { client: 'cursor', label: 'Cursor' },
];

/**
 * The ready-to-paste MCP client configuration (X27 §5.2): the absolute path of
 * the bridge's per-user copy, no args, and the token in the environment. Claude
 * Code also wants the transport named.
 */
export function configSnippet(client: SnippetClient, bridgePath: string, token: string): string {
  // The bridge refuses any other character, so a token outside the class could never connect: say so now.
  if (!TOKEN_RE.test(token)) throw new Error('refusing to write a configuration for a malformed Agent Token');
  const server = {
    ...(client === 'claude-code' ? { type: 'stdio' } : {}),
    command: bridgePath,
    args: [] as string[],
    env: { LATELIER_AGENT_TOKEN: token },
  };
  return JSON.stringify({ mcpServers: { latelier: server } }, null, 2);
}
