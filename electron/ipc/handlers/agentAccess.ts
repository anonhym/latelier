import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { zodValidator } from '../validators.ts';
import { hasUnsafeChars } from '../../agent/safeText.ts';
import type { AgentAccessService } from '../../services/AgentAccessService.ts';

const NoInput = z.undefined().or(z.null()).or(z.object({}).strict());

const SetSharedInput = z.strictObject({ connectionId: z.string().uuid(), shared: z.boolean() });
// The name is printed in main's own token dialog: a control, format or separator character would let a compromised renderer forge lines in it or reorder the text around it.
const AddTokenInput = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((name) => !hasUnsafeChars(name), 'must not contain control, format or separator characters'),
});
const TokenIdInput = z.strictObject({ id: z.string().uuid() });

/**
 * Agent Access (X27 §13). Every channel here is a request: turning the switch
 * on, sharing a Connection and showing a token each go through a main-process
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
  router.register(IPC_CHANNELS.agentAccessAddToken, zodValidator(AddTokenInput), ({ name }) => svc.addTokenWithDialog(name));
  router.register(IPC_CHANNELS.agentAccessRegenerateToken, zodValidator(TokenIdInput), ({ id }) =>
    svc.regenerateTokenWithDialog(id),
  );
  router.register(IPC_CHANNELS.agentAccessRevokeToken, zodValidator(TokenIdInput), ({ id }) => svc.revokeTokenAndNotify(id));
  router.register(IPC_CHANNELS.agentAccessRemoveBridge, zodValidator(NoInput), () => svc.removeBridge());
}
