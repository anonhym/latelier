import type { AggregationTabState } from '@shared/types';

/**
 * Which stage cards are expanded. `activeStageId` is the card the preview
 * shows; by default it is also the one expanded card (single-open). With
 * `multiOpen` on, `openStageIds` is the set of expanded cards and the selected
 * card is only the one the preview follows.
 */
export type OpenState = Pick<AggregationTabState, 'activeStageId' | 'multiOpen' | 'openStageIds'>;

/** The patch a change writes back to the tab state. */
export type OpenPatch = Partial<Pick<AggregationTabState, 'activeStageId' | 'multiOpen' | 'openStageIds'>>;

/** The expanded cards' ids. */
export function openSet(state: OpenState): ReadonlySet<number> {
  if (state.multiOpen === true) return new Set(state.openStageIds ?? []);
  return new Set(state.activeStageId === null ? [] : [state.activeStageId]);
}

/**
 * A click on a card's header. Single-open: selects it, or deselects it when it
 * already is selected. Multi-open: a closed card opens and is selected; an open
 * card that is not selected becomes the selected one and stays open; the
 * selected open card closes and clears the selection.
 */
export function toggleOpenStage(state: OpenState, id: number): OpenPatch {
  if (state.multiOpen !== true) return { activeStageId: state.activeStageId === id ? null : id };
  const open = state.openStageIds ?? [];
  if (!open.includes(id)) return { activeStageId: id, openStageIds: [...open, id] };
  if (state.activeStageId !== id) return { activeStageId: id };
  return { activeStageId: null, openStageIds: open.filter((x) => x !== id) };
}

/**
 * Turning the toggle on keeps the selected card open; turning it off collapses
 * to the single-open rule, where only the selected card is open.
 */
export function setMultiOpen(state: OpenState, on: boolean): OpenPatch {
  if (on) return { multiOpen: true, openStageIds: state.activeStageId === null ? [] : [state.activeStageId] };
  return { multiOpen: false, openStageIds: [] };
}

/** A stage that was just added, duplicated or restored opens in multi-open mode; a no-op patch otherwise. */
export function openAdded(state: OpenState, id: number): OpenPatch {
  if (state.multiOpen !== true) return {};
  const open = state.openStageIds ?? [];
  return { openStageIds: open.includes(id) ? open : [...open, id] };
}

/** Drops a removed stage from the open set, so a later stage reusing its id does not appear open. */
export function closeRemoved(state: OpenState, id: number): OpenPatch {
  if (state.openStageIds === undefined || !state.openStageIds.includes(id)) return {};
  return { openStageIds: state.openStageIds.filter((x) => x !== id) };
}
