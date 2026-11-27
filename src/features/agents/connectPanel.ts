import type { AgentCopyResult, AgentSessionInfo, SnippetClient } from '@shared/types';

/** Agent names are 1 to 64 characters, as `agent_tokens.name`. */
export const AGENT_NAME_MAX = 64;

/** Main clears a setup it put on the clipboard after this long, if it is still there (X27 §16.8). */
export const CLIPBOARD_CLEAR_MS = 5 * 60_000;

/**
 * The Connect an Agent panel (X30 §6). Step 1 turns green only once main has
 * resolved the copy; a cancelled confirm changes nothing. After the first
 * copy the panel holds the new token's id, so a second press regenerates that
 * Agent's token instead of making a second Agent.
 */
export interface ConnectPanelState {
  name: string;
  client: SnippetClient;
  copying: boolean;
  tokenId: string | null;
  /** When main's clipboard write returned, and for which client. */
  copiedAt: string | null;
  copiedClient: SnippetClient | null;
}

export type ConnectPanelAction =
  | { type: 'name'; name: string }
  | { type: 'client'; client: SnippetClient }
  | { type: 'copyStart' }
  | { type: 'copyDone'; result: AgentCopyResult; client: SnippetClient }
  | { type: 'copyFailed' };

export function initialConnectPanel(client: SnippetClient, tokenId: string | null = null): ConnectPanelState {
  return { name: '', client, copying: false, tokenId, copiedAt: null, copiedClient: null };
}

export function connectPanelReducer(state: ConnectPanelState, action: ConnectPanelAction): ConnectPanelState {
  switch (action.type) {
    case 'name':
      // The Agent exists once its token does; its name is changed by Rename, not here.
      return state.tokenId ? state : { ...state, name: action.name };
    case 'client':
      return { ...state, client: action.client };
    case 'copyStart':
      return { ...state, copying: true };
    case 'copyFailed':
      return { ...state, copying: false };
    case 'copyDone':
      if ('cancelled' in action.result) return { ...state, copying: false };
      return {
        ...state,
        copying: false,
        tokenId: action.result.tokenId,
        copiedAt: action.result.copiedAt,
        copiedClient: action.client,
      };
  }
}

/** A name of 1 to 64 characters once trimmed; an existing Agent needs none. */
export function nameValid(state: Pick<ConnectPanelState, 'name' | 'tokenId'>): boolean {
  if (state.tokenId) return true;
  const n = state.name.trim().length;
  return n >= 1 && n <= AGENT_NAME_MAX;
}

export function canCopy(state: ConnectPanelState): boolean {
  return !state.copying && nameValid(state);
}

/** What pressing Copy asks of main: a new Agent the first time, its setup again after. */
export function copyRequest(
  state: ConnectPanelState,
): { kind: 'connect'; name: string; client: SnippetClient } | { kind: 'copy'; id: string; client: SnippetClient } {
  return state.tokenId
    ? { kind: 'copy', id: state.tokenId, client: state.client }
    : { kind: 'connect', name: state.name.trim(), client: state.client };
}

/** Step 1 is done while the clipboard holds the setup for the client now chosen. */
export function copyStepDone(state: Pick<ConnectPanelState, 'copiedClient' | 'client'>): boolean {
  // `copiedClient` is set with `copiedAt`, only by a resolved copy.
  return state.copiedClient === state.client;
}

/** When main clears the clipboard, if the setup is still on it. */
export function clipboardClearAt(copiedAt: string): string {
  return new Date(new Date(copiedAt).getTime() + CLIPBOARD_CLEAR_MS).toISOString();
}

/** The first session with this token: the one that turns step 4 green. */
export function firstSessionOf(
  sessions: ReadonlyArray<AgentSessionInfo>,
  tokenId: string | null,
): AgentSessionInfo | null {
  const mine = sessions.filter((s) => s.tokenId === tokenId).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return mine[0] ?? null;
}
