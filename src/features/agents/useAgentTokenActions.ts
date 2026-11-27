import React from 'react';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { confirmDestructive } from '../../utils/confirm';
import type { AgentCopyResult, AgentTokenInfo, SnippetClient } from '@shared/types';
import { AGENT_CLIENT_OPTIONS } from '../agentAccess/agentClients';

/** The client's name as the Connect panel and main's confirm show it. */
export function clientLabel(client: SnippetClient): string {
  return AGENT_CLIENT_OPTIONS.find((o) => o.value === client)?.label ?? client;
}

/** The toast once main has put a setup on the clipboard (X30 §6). Nothing on a cancelled confirm. */
export function announceCopied(result: AgentCopyResult, client: SnippetClient, name: string): boolean {
  if ('cancelled' in result) return false;
  const label = clientLabel(client);
  notify.success(`It contains the Agent Token for “${name}”. Paste it into ${label} now.`, {
    title: `${label} setup copied`,
  });
  return true;
}

export type AgentTokenDialog = { kind: 'copy'; token: AgentTokenInfo } | { kind: 'rename'; token: AgentTokenInfo } | null;

export interface AgentTokenActions {
  dialog: AgentTokenDialog;
  closeDialog: () => void;
  busy: boolean;
  /** Opens the client choice for Copy setup again… */
  askCopySetup: (token: AgentTokenInfo) => void;
  /** Regenerates the token after main's confirm, ending its live sessions, and copies the setup. */
  copySetup: (token: AgentTokenInfo, client: SnippetClient) => Promise<void>;
  askRename: (token: AgentTokenInfo) => void;
  rename: (token: AgentTokenInfo, name: string) => Promise<boolean>;
  /** Asks in an app dialog, then revokes, which ends every session of that token. */
  revoke: (token: AgentTokenInfo) => Promise<void>;
}

/**
 * An Agent's menu (X30 §3, §5.3): Copy setup again…, Rename…, Revoke…. Shared
 * by the sidebar row and the Agent page. Main owns every confirm that guards
 * the token; the renderer only asks.
 */
export function useAgentTokenActions(): AgentTokenActions {
  const [dialog, setDialog] = React.useState<AgentTokenDialog>(null);
  const [busy, setBusy] = React.useState(false);

  const closeDialog = React.useCallback(() => setDialog(null), []);
  const askCopySetup = React.useCallback((token: AgentTokenInfo) => setDialog({ kind: 'copy', token }), []);
  const askRename = React.useCallback((token: AgentTokenInfo) => setDialog({ kind: 'rename', token }), []);

  const copySetup = React.useCallback(async (token: AgentTokenInfo, client: SnippetClient) => {
    setBusy(true);
    try {
      const result = await api.agentAccess.copySetup({ id: token.id, client });
      if (announceCopied(result, client, token.name)) setDialog(null);
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not copy the setup.'));
    } finally {
      setBusy(false);
    }
  }, []);

  const rename = React.useCallback(async (token: AgentTokenInfo, name: string) => {
    setBusy(true);
    try {
      await api.agentAccess.renameToken({ id: token.id, name: name.trim() });
      setDialog(null);
      return true;
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not rename the Agent.'));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = React.useCallback(async (token: AgentTokenInfo) => {
    const yes = await confirmDestructive({
      title: `Revoke “${token.name}”?`,
      body: 'Its live sessions end, and its setup stops working in every client it was pasted into. This cannot be undone.',
      confirmLabel: 'Revoke',
      focusCancel: true,
    });
    if (!yes) return;
    try {
      await api.agentAccess.revokeToken({ id: token.id });
    } catch (err) {
      notify.error(getErrorMessage(err, 'Could not revoke the Agent.'));
    }
  }, []);

  return React.useMemo(
    () => ({ dialog, closeDialog, busy, askCopySetup, copySetup, askRename, rename, revoke }),
    [dialog, closeDialog, busy, askCopySetup, copySetup, askRename, rename, revoke],
  );
}
