import { describe, expect, it } from 'vitest';
import {
  closeRemoved,
  openAdded,
  openSet,
  setMultiOpen,
  toggleOpenStage,
} from '../../src/pages/Workspace/Aggregation/stageOpen';

describe('openSet', () => {
  it('single-open: the selected card alone, or none', () => {
    expect([...openSet({ activeStageId: 3 })]).toEqual([3]);
    expect([...openSet({ activeStageId: null })]).toEqual([]);
    // A leftover set from multi mode is ignored once the toggle is off.
    expect([...openSet({ activeStageId: 3, multiOpen: false, openStageIds: [1, 2] })]).toEqual([3]);
  });
  it('multi-open: the open set, whatever is selected', () => {
    expect([...openSet({ activeStageId: 3, multiOpen: true, openStageIds: [1, 2] })]).toEqual([1, 2]);
    expect([...openSet({ activeStageId: null, multiOpen: true })]).toEqual([]);
  });
});

describe('toggleOpenStage', () => {
  it('single-open: selects, and deselects the selected card', () => {
    expect(toggleOpenStage({ activeStageId: null }, 2)).toEqual({ activeStageId: 2 });
    expect(toggleOpenStage({ activeStageId: 1 }, 2)).toEqual({ activeStageId: 2 });
    expect(toggleOpenStage({ activeStageId: 2 }, 2)).toEqual({ activeStageId: null });
  });
  it('multi-open: a closed card opens and is selected, keeping the others open', () => {
    expect(toggleOpenStage({ activeStageId: 1, multiOpen: true, openStageIds: [1] }, 2)).toEqual({
      activeStageId: 2,
      openStageIds: [1, 2],
    });
    expect(toggleOpenStage({ activeStageId: null, multiOpen: true }, 2)).toEqual({
      activeStageId: 2,
      openStageIds: [2],
    });
  });
  it('multi-open: an open card that is not selected becomes selected and stays open', () => {
    expect(toggleOpenStage({ activeStageId: 2, multiOpen: true, openStageIds: [1, 2] }, 1)).toEqual({
      activeStageId: 1,
    });
  });
  it('multi-open: the selected open card closes and clears the selection', () => {
    expect(toggleOpenStage({ activeStageId: 2, multiOpen: true, openStageIds: [1, 2] }, 2)).toEqual({
      activeStageId: null,
      openStageIds: [1],
    });
  });
});

describe('setMultiOpen', () => {
  it('turning it on keeps the selected card open', () => {
    expect(setMultiOpen({ activeStageId: 4 }, true)).toEqual({ multiOpen: true, openStageIds: [4] });
    expect(setMultiOpen({ activeStageId: null }, true)).toEqual({ multiOpen: true, openStageIds: [] });
  });
  it('turning it off drops the set, leaving only the selected card open', () => {
    expect(setMultiOpen({ activeStageId: 4, multiOpen: true, openStageIds: [1, 4] }, false)).toEqual({
      multiOpen: false,
      openStageIds: [],
    });
  });
});

describe('openAdded', () => {
  it('opens an added stage in multi-open mode only', () => {
    expect(openAdded({ activeStageId: 1, multiOpen: true, openStageIds: [1] }, 2)).toEqual({ openStageIds: [1, 2] });
    expect(openAdded({ activeStageId: 1, multiOpen: true }, 2)).toEqual({ openStageIds: [2] });
    expect(openAdded({ activeStageId: 1 }, 2)).toEqual({});
  });
  it('does not list a stage twice', () => {
    expect(openAdded({ activeStageId: 1, multiOpen: true, openStageIds: [2] }, 2)).toEqual({ openStageIds: [2] });
  });
});

describe('closeRemoved', () => {
  it('prunes a removed stage so a reused id does not appear open', () => {
    expect(closeRemoved({ activeStageId: null, multiOpen: true, openStageIds: [1, 2] }, 2)).toEqual({
      openStageIds: [1],
    });
  });
  it('is a no-op when it was not open', () => {
    expect(closeRemoved({ activeStageId: null, multiOpen: true, openStageIds: [1] }, 2)).toEqual({});
    expect(closeRemoved({ activeStageId: null }, 2)).toEqual({});
  });
});
