import React from 'react';
import { api, getErrorMessage } from '../../api/atelier';
import { notify } from '../../theme/notifications';
import { confirmDestructive } from '../../utils/confirm';
import { logFailure } from '../../utils/rendererLog';
import { notifyReferenceRulesChanged } from '../references/useReferenceRules';
import type { AgentProposal, AgentProposalCheck, AgentProposalSavedFor } from '@shared/types';
import { checkProposal, refreshProposals } from './proposalStore';
import { proposalPairText } from './proposalView';

/**
 * The check of an opened Proposal (X28 §5): asked for once it is shown,
 * never on the Agent's call. Null while it reads, or when it failed.
 */
export function useProposalCheck(id: string): { check: AgentProposalCheck | null; failed: boolean } {
  const [state, setState] = React.useState<{ id: string; check: AgentProposalCheck | null; failed: boolean }>({ id, check: null, failed: false });
  React.useEffect(() => {
    let live = true;
    checkProposal(id).then(
      (check) => live && setState({ id, check, failed: false }),
      (err: unknown) => {
        logFailure('checking an Agent Proposal', err);
        if (live) setState({ id, check: null, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [id]);
  // A result for another Proposal is not this one's.
  return state.id === id ? { check: state.check, failed: state.failed } : { check: null, failed: false };
}

/** The Connection's Family, for Save for the Family; null when it has none or while it reads. */
export function useFamilyOf(connectionId: string): { id: string; name: string } | null {
  const [family, setFamily] = React.useState<{ connectionId: string; id: string; name: string } | null>(null);
  React.useEffect(() => {
    let live = true;
    api.families.list().then(
      (families) => {
        const f = families.find((x) => x.memberIds.includes(connectionId));
        if (live) setFamily(f ? { connectionId, id: f.id, name: f.name } : null);
      },
      (err: unknown) => logFailure('listing Families', err),
    );
    return () => {
      live = false;
    };
  }, [connectionId]);
  return family && family.connectionId === connectionId ? { id: family.id, name: family.name } : null;
}

export interface ProposalActions {
  busy: boolean;
  /** Add Reference Rule: creates the rule from the stored pair. */
  accept: (savedFor: AgentProposalSavedFor) => Promise<void>;
  /** Not now: pending becomes later. */
  later: () => Promise<void>;
  /** Move back: later becomes pending. */
  reopen: () => Promise<void>;
  /** Never for this pair, after an app confirm. */
  decline: () => Promise<void>;
}

/**
 * Deciding a Proposal (X28 §6). Each decision lists the Proposals again, so
 * every surface follows; a refusal (one decided elsewhere, or a source field
 * that gained a rule) says why and lists again too.
 */
export function useProposalActions(proposal: AgentProposal): ProposalActions {
  const [busy, setBusy] = React.useState(false);
  // One decision at a time: a second one asked before the first settles (a click, Escape) is dropped.
  const inFlight = React.useRef(false);
  const pair = proposalPairText(proposal);
  const id = proposal.id;

  const run = React.useCallback(async (work: () => Promise<void>, failure: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await work();
    } catch (err) {
      notify.error(getErrorMessage(err, failure));
    } finally {
      inFlight.current = false;
      setBusy(false);
      void refreshProposals();
    }
  }, []);

  const accept = React.useCallback(
    (savedFor: AgentProposalSavedFor) =>
      run(async () => {
        await api.agentProposals.accept({ id, savedFor });
        notifyReferenceRulesChanged();
        notify.success(pair, { title: savedFor === 'family' ? 'Reference Rule added for the Family' : 'Reference Rule added' });
      }, 'Could not add the Reference Rule.'),
    [run, id, pair],
  );
  const later = React.useCallback(
    () => run(() => api.agentProposals.later({ id }).then(() => undefined), 'Could not put the Proposal off.'),
    [run, id],
  );
  const reopen = React.useCallback(
    () => run(() => api.agentProposals.reopen({ id }).then(() => undefined), 'Could not move the Proposal back.'),
    [run, id],
  );
  const decline = React.useCallback(async () => {
    if (inFlight.current) return;
    const yes = await confirmDestructive({
      title: 'Never for this pair?',
      body: `${pair} will not be suggested again, by reference discovery or by any Agent.`,
      confirmLabel: 'Never for this pair',
      focusCancel: true,
    });
    if (!yes) return;
    await run(() => api.agentProposals.decline({ id }).then(() => undefined), 'Could not decline the Proposal.');
  }, [run, id, pair]);

  return { busy, accept, later, reopen, decline };
}
