import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { zodValidator } from '../validators.ts';
import { hasUnsafeChars } from '../../agent/safeText.ts';
import type { AgentAccessService } from '../../services/AgentAccessService.ts';

const NoInput = z.undefined().or(z.null()).or(z.object({}).strict());

const SetSharedInput = z.strictObject({ connectionId: z.string().uuid(), shared: z.boolean() });
// The name is printed in main's own copy confirm: a control, format or separator character would let a compromised renderer forge lines in it or reorder the text around it.
const AgentName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((name) => !hasUnsafeChars(name), 'must not contain control, format or separator characters');
const Client = z.enum(['claude-code-cli', 'claude-code', 'claude-desktop', 'cursor']);
const TokenIdInput = z.strictObject({ id: z.string().uuid() });
const ConnectClientInput = z.strictObject({ name: AgentName, client: Client });
const CopySetupInput = z.strictObject({ id: z.string().uuid(), client: Client });
const RenameTokenInput = z.strictObject({ id: z.string().uuid(), name: AgentName });
const DismissRequestInput = z.strictObject({ sessionId: z.string().uuid(), connectionId: z.string().uuid() });

const PAGE_LIMIT = z.number().int().min(1).max(200);
// Names an Agent sent or a log row holds: matched exactly, never parsed.
const LoggedName = z.string().max(256);
const Timestamp = z.string().max(64);

const ListCallsInput = z.strictObject({
  sessionId: z.string().uuid().optional(),
  tokenId: z.string().uuid().optional(),
  connectionId: z.string().uuid().optional(),
  database: LoggedName.optional(),
  collection: LoggedName.optional(),
  tool: LoggedName.optional(),
  outcome: z.enum(['all', 'ok', 'refused']),
  before: z.strictObject({ ts: Timestamp, id: z.string().uuid() }).optional(),
  limit: PAGE_LIMIT,
});
const ListSessionsInput = z.strictObject({
  tokenId: z.string().uuid().optional(),
  includeEnded: z.boolean(),
  before: z.strictObject({ startedAt: Timestamp, id: z.string().uuid() }).optional(),
  limit: PAGE_LIMIT,
});
const EndSessionInput = z.strictObject({ sessionId: z.string().uuid() });

/**
 * Agent Access (X27 §13). Every channel here is a request: turning the switch
 * on, sharing a Connection and copying a setup each go through a main-process
 * dialog inside the service, so a compromised renderer cannot answer them. No
 * channel takes or returns a token, so none belongs on the secret-input allowlist.
 */
export function registerAgentAccessChannels(router: Router, svc: AgentAccessService): void {
  router.register(IPC_CHANNELS.agentAccessGetState, zodValidator(NoInput), () => svc.getState());
  router.register(IPC_CHANNELS.agentAccessRequestEnable, zodValidator(NoInput), () => svc.requestEnable());
  router.register(IPC_CHANNELS.agentAccessDisable, zodValidator(NoInput), () => svc.disable());
  router.register(IPC_CHANNELS.agentAccessSetShared, zodValidator(SetSharedInput), ({ connectionId, shared }) =>
    svc.requestSetShared(connectionId, shared),
  );
  // X27 §16.8: a token is created or regenerated only after main's confirm, and only ever written to the clipboard.
  router.register(IPC_CHANNELS.agentAccessConnectClient, zodValidator(ConnectClientInput), ({ name, client }) =>
    svc.connectClient(name, client),
  );
  router.register(IPC_CHANNELS.agentAccessCopySetup, zodValidator(CopySetupInput), ({ id, client }) => svc.copySetup(id, client));
  router.register(IPC_CHANNELS.agentAccessRenameToken, zodValidator(RenameTokenInput), ({ id, name }) => svc.renameToken(id, name));
  router.register(IPC_CHANNELS.agentAccessRevokeToken, zodValidator(TokenIdInput), ({ id }) => svc.revokeTokenAndNotify(id));
  router.register(IPC_CHANNELS.agentAccessRemoveBridge, zodValidator(NoInput), () => svc.removeBridge());
  // Reading the log (X27 §16.5): the renderer never reads SQLite or decrypts anything itself.
  router.register(IPC_CHANNELS.agentAccessListCalls, zodValidator(ListCallsInput), (query) => svc.listCalls(query));
  router.register(IPC_CHANNELS.agentAccessListSessions, zodValidator(ListSessionsInput), (query) => svc.listSessions(query));
  router.register(IPC_CHANNELS.agentAccessEndSession, zodValidator(EndSessionInput), ({ sessionId }) => svc.endSession(sessionId));
  router.register(IPC_CHANNELS.agentAccessDismissRequest, zodValidator(DismissRequestInput), ({ sessionId, connectionId }) =>
    svc.dismissRequest(sessionId, connectionId),
  );
}
