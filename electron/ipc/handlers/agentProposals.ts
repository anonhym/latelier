import { z } from 'zod';
import { IPC_CHANNELS } from '@shared/ipc';
import type { Router } from '../router.ts';
import { zodValidator } from '../validators.ts';
import type { AgentProposalService } from '../../services/AgentProposalService.ts';

const IdInput = z.strictObject({ id: z.string().uuid() });
const AcceptInput = z.strictObject({ id: z.string().uuid(), savedFor: z.enum(['connection', 'family']) });
const ListInput = z.strictObject({
  status: z.enum(['open', 'decided']).optional(),
  connectionId: z.string().uuid().optional(),
  sessionId: z.string().uuid().optional(),
  before: z.strictObject({ createdAt: z.string().max(64), id: z.string().uuid() }).optional(),
  limit: z.number().int().min(1).max(200),
});

/**
 * Agent Proposals (X28 §8). The renderer names a Proposal by id and, to
 * accept, only who the rule is saved for: main reads the pair from the stored
 * row. No channel takes a secret, and `accept` adds no power `refs:create`
 * does not already give.
 */
export function registerAgentProposalsChannels(router: Router, svc: AgentProposalService): void {
  router.register(IPC_CHANNELS.agentProposalsList, zodValidator(ListInput), (query) => svc.list(query));
  router.register(IPC_CHANNELS.agentProposalsCheck, zodValidator(IdInput), ({ id }) => svc.check(id));
  router.register(IPC_CHANNELS.agentProposalsAccept, zodValidator(AcceptInput), ({ id, savedFor }) => svc.accept(id, savedFor));
  router.register(IPC_CHANNELS.agentProposalsLater, zodValidator(IdInput), ({ id }) => svc.later(id));
  router.register(IPC_CHANNELS.agentProposalsReopen, zodValidator(IdInput), ({ id }) => svc.reopen(id));
  router.register(IPC_CHANNELS.agentProposalsDecline, zodValidator(IdInput), ({ id }) => svc.decline(id));
}
