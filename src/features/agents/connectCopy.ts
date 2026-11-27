import type { SnippetClient } from '@shared/types';

/**
 * Where each client's setup goes (X30 §6). Claude Desktop and Cursor name
 * their MCP settings without a menu path until those paths are checked
 * against the current clients by hand.
 */
export const PASTE_WHERE: Readonly<Record<SnippetClient, string>> = {
  'claude-code-cli': 'Paste the command into a terminal and run it. It adds L\'Atelier to Claude Code in every project.',
  'claude-code': "Paste it into Claude Code's MCP configuration, or merge its latelier entry into the servers you already have.",
  'claude-desktop': "Paste it into Claude Desktop's MCP settings, or merge its latelier entry into the servers you already have.",
  cursor: "Paste it into Cursor's MCP settings, or merge its latelier entry into the servers you already have.",
};

/** The placeholder main writes where the token goes. */
export const TOKEN_PLACEHOLDER = 'YOUR_TOKEN';
