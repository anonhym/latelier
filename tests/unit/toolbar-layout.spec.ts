import { describe, expect, it } from 'vitest';
import { canvasHeaderLayout, statusCountLayout } from '../../src/pages/Workspace/toolbarLayout';

describe('canvasHeaderLayout', () => {
  it.each([
    [700, false],
    [699, true],
    [520, true],
  ])('at %i px, icons: %s', (width, iconControls) => {
    expect(canvasHeaderLayout(width).iconControls).toBe(iconControls);
  });

  // The References button shifts the step by its own width.
  it.each([
    [841, false],
    [840, true],
  ])('with References, at %i px, icons: %s', (width, iconControls) => {
    expect(canvasHeaderLayout(width, true).iconControls).toBe(iconControls);
  });

  // The pager's First and Last go before anything else of the pager does.
  it.each([
    [520, true],
    [519, false],
    [320, false],
  ])('at %i px, pager ends: %s', (width, pagerEnds) => {
    expect(canvasHeaderLayout(width).pagerEnds).toBe(pagerEnds);
    expect(canvasHeaderLayout(width, true).pagerEnds).toBe(pagerEnds);
  });

  it('with no measured width (no layout), keeps the labels', () => {
    expect(canvasHeaderLayout(null)).toEqual({ iconControls: false, pagerEnds: true });
    expect(canvasHeaderLayout(null, true)).toEqual({ iconControls: false, pagerEnds: true });
  });

  // The rule is enforced by the signature: nothing about the query can reach it.
  it('takes the width and nothing else', () => {
    expect(canvasHeaderLayout.length).toBe(1);
    expect(statusCountLayout.length).toBe(1);
  });
});

describe('statusCountLayout', () => {
  it.each([
    [320, { planBadge: true }],
    [200, { planBadge: true }],
    [199, { planBadge: false }],
    [160, { planBadge: false }],
  ])('at %i px', (width, expected) => {
    expect(statusCountLayout(width)).toEqual(expected);
  });

  it('with no measured width (no layout), gives room for everything', () => {
    expect(statusCountLayout(null)).toEqual({ planBadge: true });
  });
});
