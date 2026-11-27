import type { SnippetClient } from '@shared/types';

/** The MCP clients Settings can copy a setup for, in main's order, with the names main's confirm uses. */
export const AGENT_CLIENT_OPTIONS: ReadonlyArray<{ value: SnippetClient; label: string }> = [
  { value: 'claude-code-cli', label: 'Claude Code (command)' },
  { value: 'claude-code', label: 'Claude Code (JSON)' },
  { value: 'claude-desktop', label: 'Claude Desktop' },
  { value: 'cursor', label: 'Cursor' },
];

export const DEFAULT_AGENT_CLIENT: SnippetClient = 'claude-code-cli';

export function isAgentClient(value: string): value is SnippetClient {
  return AGENT_CLIENT_OPTIONS.some((o) => o.value === value);
}
