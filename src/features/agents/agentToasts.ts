import type { ConnectionRequestItem, NeedsYouItem, ProposalItem } from './needsYou';

/**
 * Agent toasts in Databases mode (X30 §10.1), as a pure state step. Each new
 * Needs you item toasts once; a later refusal of the same pair has the same
 * key, so its toast is drawn from the newer item in place and never added
 * again. A toast stays until it is acted on or dismissed, and either only
 * hides it: the item stays in Needs you and keeps its badge.
 */
export interface ToastState {
  /** Keys of items already offered (toasted, or seen while no toast could show). */
  seen: ReadonlySet<string>;
  /** Keys with a toast up, newest first. */
  open: readonly string[];
  /**
   * Set once the first list of Proposals has landed. Proposals outlive a run,
   * so the ones already open at launch are badged, not toasted.
   */
  proposalsBaselined: boolean;
}

export const INITIAL_TOASTS: ToastState = { seen: new Set(), open: [], proposalsBaselined: false };

/** From the fourth open request toast, the request toasts fold into one. */
export const FOLD_AT = 4;

export interface ToastInput {
  /** Every open Connection request and `pending` Proposal. */
  items: readonly NeedsYouItem[];
  /** In Agents mode the item shows in the list in place: it is seen, never toasted. */
  agentsMode: boolean;
  /** False until the first list of Proposals has been read. */
  proposalsLoaded: boolean;
}

/**
 * The next toast state for the items now open. An item no longer open is
 * forgotten, so a fresh request for the same pair later toasts again.
 */
export function stepToasts(prev: ToastState, input: ToastInput): ToastState {
  const keys = new Set(input.items.map((i) => i.key));
  const seen = new Set([...prev.seen].filter((k) => keys.has(k)));
  const open = prev.open.filter((k) => keys.has(k));
  const baselining = input.proposalsLoaded && !prev.proposalsBaselined;
  const added: string[] = [];
  for (const item of input.items) {
    if (seen.has(item.key)) continue;
    // A Proposal waits for the first list: it is the baseline, or a new one.
    if (item.kind === 'proposal' && !input.proposalsLoaded) continue;
    seen.add(item.key);
    if (input.agentsMode) continue;
    if (item.kind === 'proposal' && baselining) continue;
    added.push(item.key);
  }
  // Items arrive newest first; the newest ends on top.
  const nextOpen = [...added, ...open];
  const proposalsBaselined = prev.proposalsBaselined || input.proposalsLoaded;
  // The same state back when nothing changed, so a caller holding it in React state does not re-render.
  const unchanged =
    proposalsBaselined === prev.proposalsBaselined &&
    sameKeys([...seen], [...prev.seen]) &&
    sameKeys(nextOpen, prev.open);
  if (unchanged) return prev;
  return { seen, open: nextOpen, proposalsBaselined };
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/** Hides one toast, dismissed with ✕ or acted on. The item stays seen, so it never toasts again while open. */
export function hideToast(prev: ToastState, key: string): ToastState {
  if (!prev.open.includes(key)) return prev;
  return { ...prev, open: prev.open.filter((k) => k !== key) };
}

/** Hides every request toast at once: what Open Agents on the folded toast acts on. */
export function hideRequestToasts(prev: ToastState, items: readonly NeedsYouItem[]): ToastState {
  const requests = new Set(items.filter((i) => i.kind === 'connection-request').map((i) => i.key));
  const open = prev.open.filter((k) => !requests.has(k));
  return open.length === prev.open.length ? prev : { ...prev, open };
}

export type ToastCard =
  | { kind: 'request'; key: string; item: ConnectionRequestItem }
  | { kind: 'proposal'; key: string; item: ProposalItem }
  | { kind: 'fold'; key: 'fold'; count: number };

/**
 * The cards to draw, newest on top, each from the item as it is now. None in
 * Agents mode. From the fourth request toast the request toasts are one
 * "{n} Agent requests" card, where the newest of them stood.
 */
export function toastCards(state: ToastState, items: readonly NeedsYouItem[], agentsMode: boolean): ToastCard[] {
  if (agentsMode) return [];
  const byKey = new Map(items.map((i) => [i.key, i]));
  const cards: ToastCard[] = [];
  for (const key of state.open) {
    const item = byKey.get(key);
    if (!item) continue;
    cards.push(item.kind === 'proposal' ? { kind: 'proposal', key, item } : { kind: 'request', key, item });
  }
  const requests = cards.filter((c) => c.kind === 'request').length;
  if (requests < FOLD_AT) return cards;
  const folded: ToastCard[] = [];
  for (const card of cards) {
    if (card.kind !== 'request') folded.push(card);
    else if (!folded.some((c) => c.kind === 'fold')) folded.push({ kind: 'fold', key: 'fold', count: requests });
  }
  return folded;
}

/** The folded card's title. */
export function foldTitle(count: number): string {
  return `${count} Agent requests`;
}
