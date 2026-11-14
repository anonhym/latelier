import { describe, expect, it } from 'vitest';
import { canvasHeaderLayout, outputBarActions, statusCountLayout } from '../../src/pages/Workspace/toolbarLayout';

describe('canvasHeaderLayout', () => {
  it.each([
    [400, false],
    [399, true],
    [320, true],
  ])('at %i px, icons: %s', (width, iconControls) => {
    expect(canvasHeaderLayout(width)).toEqual({ iconControls });
  });

  // The References button shifts the step by its own width.
  it.each([
    [541, false],
    [540, true],
  ])('with References, at %i px, icons: %s', (width, iconControls) => {
    expect(canvasHeaderLayout(width, true)).toEqual({ iconControls });
  });

  it('with no measured width (no layout), keeps the labels', () => {
    expect(canvasHeaderLayout(null)).toEqual({ iconControls: false });
    expect(canvasHeaderLayout(null, true)).toEqual({ iconControls: false });
  });

  // The rule is enforced by the signature: nothing about the query can reach it.
  it('takes the width and nothing else', () => {
    expect(canvasHeaderLayout.length).toBe(1);
    expect(statusCountLayout.length).toBe(1);
    expect(outputBarActions.length).toBe(1);
  });
});

describe('statusCountLayout', () => {
  it.each([
    [320, { count: 'full', planBadge: true }],
    [319, { count: 'range', planBadge: true }],
    [200, { count: 'range', planBadge: true }],
    [199, { count: 'range', planBadge: false }],
    [160, { count: 'range', planBadge: false }],
    [159, { count: 'total', planBadge: false }],
  ])('at %i px', (width, expected) => {
    expect(statusCountLayout(width)).toEqual(expected);
  });

  it('with no measured width (no layout), gives room for everything', () => {
    expect(statusCountLayout(null)).toEqual({ count: 'full', planBadge: true });
  });
});

describe('outputBarActions', () => {
  it.each([
    [760, 'labels'],
    [759, 'icons'],
    [592, 'icons'],
    [520, 'icons'],
    [519, 'menu'],
    [423, 'menu'],
  ])('at %i px is %s', (width, expected) => {
    expect(outputBarActions(width)).toBe(expected);
  });

  it('with no measured width, shows labels', () => {
    expect(outputBarActions(null)).toBe('labels');
  });
});
