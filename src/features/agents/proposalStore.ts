import React from 'react';
import { api } from '../../api/atelier';
import { logFailure } from '../../utils/rendererLog';
import type { AgentProposal, AgentProposalCheck } from '@shared/types';

/**
 * The open Agent Proposals (X28), read once by `useProposalSync` in the
 * Workspace and listed again on every `agentProposals:changed-event`. The
 * badge, Needs you, the toasts and each collection's strip read this one
 * copy, so they cannot disagree.
 */
export interface OpenProposals {
  list: readonly AgentProposal[];
  /** False until the first list has landed. */
  loaded: boolean;
}

const PAGE = 200;
const EMPTY: OpenProposals = { list: [], loaded: false };

let snapshot: OpenProposals = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setOpenProposals(list: readonly AgentProposal[]): void {
  snapshot = { list, loaded: true };
  emit();
}

/** Forgets every Proposal; for tests. */
export function resetProposalStore(): void {
  snapshot = EMPTY;
  checks.clear();
  emit();
}

export function useOpenProposals(): OpenProposals {
  return React.useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Every open Proposal, newest first. Reads page after page; only an empty
 * page ends the read, never a short one.
 */
export async function readOpenProposals(): Promise<AgentProposal[]> {
  const out: AgentProposal[] = [];
  let before: { createdAt: string; id: string } | undefined;
  for (;;) {
    const page = await api.agentProposals.list({ status: 'open', limit: PAGE, ...(before ? { before } : {}) });
    if (page.length === 0) return out;
    const last = page[page.length - 1]!;
    // A page that does not move past the last one would loop forever.
    if (before && last.id === before.id) return out;
    out.push(...page);
    before = { createdAt: last.createdAt, id: last.id };
  }
}

let reading: Promise<void> | null = null;
let again = false;

/** Lists the open Proposals again. Calls that land while a read runs coalesce into one more read. */
export function refreshProposals(): Promise<void> {
  if (reading) {
    again = true;
    return reading;
  }
  reading = (async () => {
    try {
      do {
        again = false;
        setOpenProposals(await readOpenProposals());
      } while (again);
    } catch (err) {
      logFailure('listing Agent Proposals', err);
    } finally {
      reading = null;
    }
  })();
  return reading;
}

/** Keeps the store current for the Workspace's life: one list now, one more per change event. */
export function useProposalSync(): void {
  React.useEffect(() => {
    void refreshProposals();
    try {
      return api.agentProposals.onChanged(() => void refreshProposals());
    } catch (err) {
      logFailure('subscribing to Agent Proposals', err);
      return undefined;
    }
  }, []);
}

/**
 * Each Proposal's check, read once per run once it has read samples: a tab
 * switch or a second surface does not sample again. A check that could not
 * read (the Connection not open) is read again the next time it is shown.
 */
const checks = new Map<string, Promise<AgentProposalCheck>>();

export function checkProposal(id: string): Promise<AgentProposalCheck> {
  const known = checks.get(id);
  if (known) return known;
  const read = api.agentProposals.check({ id }).then(
    (result) => {
      if (result.kind !== 'sampled') checks.delete(id);
      return result;
    },
    (err: unknown) => {
      checks.delete(id);
      throw err;
    },
  );
  checks.set(id, read);
  return read;
}
