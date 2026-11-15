import { describe, expect, it } from 'vitest';
import {
  canvasHeaderLayout,
  pageLabelWidth,
  statusCountLayout,
  totalLabelText,
} from '../../src/pages/Workspace/toolbarLayout';

// Each form is named by the first thing it gives up, in the order the bar narrows.
const FORM = {
  labels: { iconControls: false, pagerEnds: true, pageSize: true, compactViews: false, labelReserve: true },
  icons: { iconControls: true, pagerEnds: true, pageSize: true, compactViews: false, labelReserve: true },
  noEnds: { iconControls: true, pagerEnds: false, pageSize: true, compactViews: false, labelReserve: true },
  noSize: { iconControls: true, pagerEnds: false, pageSize: false, compactViews: false, labelReserve: true },
  views: { iconControls: true, pagerEnds: false, pageSize: false, compactViews: true, labelReserve: true },
  noReserve: { iconControls: true, pagerEnds: false, pageSize: false, compactViews: true, labelReserve: false },
} as const;

describe('pageLabelWidth', () => {
  it.each([
    ['', 18],
    ['123', 89],
    ['123,456', 169],
    // `+` is as wide as a figure; any separator counts as one, a narrow no-break space included.
    ['1,234+', 146],
    ['1 234', 122],
  ])('for %j', (total, width) => {
    expect(pageLabelWidth(total)).toBe(width);
  });
});

describe('totalLabelText', () => {
  it('writes a counted total whole', () => {
    expect(totalLabelText(6382, 50, true)).toBe('6,382');
  });

  it('marks an uncounted total with more to come as a lower bound at the end of the range', () => {
    expect(totalLabelText(undefined, 150, true)).toBe('150+');
  });

  it('leaves an uncounted total without more as it is', () => {
    expect(totalLabelText(undefined, 12, false)).toBe('12');
  });

  it('counts a zero total as 0', () => {
    expect(totalLabelText(0, 0, false)).toBe('0');
  });
});

describe('canvasHeaderLayout', () => {
  // Without References, a 3-character total ("123"): the label takes 89px.
  it.each([
    [693, FORM.labels],
    [692, FORM.icons],
    [559, FORM.icons],
    [558, FORM.noEnds],
    [515, FORM.noEnds],
    [514, FORM.noSize],
    [459, FORM.noSize],
    [458, FORM.views],
    [399, FORM.views],
    [398, FORM.noReserve],
    [320, FORM.noReserve],
  ])('at %i px, a 3-character total, no References', (width, form) => {
    expect(canvasHeaderLayout(width, false, '123')).toEqual(form);
  });

  // 7 characters ("123,456"): the label takes 169px, so every step moves 80px up.
  it.each([
    [773, FORM.labels],
    [772, FORM.icons],
    [639, FORM.icons],
    [638, FORM.noEnds],
    [595, FORM.noEnds],
    [594, FORM.noSize],
    [539, FORM.noSize],
    [538, FORM.views],
    [479, FORM.views],
    [478, FORM.noReserve],
    [320, FORM.noReserve],
  ])('at %i px, a 7-character total, no References', (width, form) => {
    expect(canvasHeaderLayout(width, false, '123,456')).toEqual(form);
  });

  // With References: a labelled button is 134px (and a gap), an icon 22px.
  it.each([
    [835, FORM.labels],
    [834, FORM.icons],
    [587, FORM.icons],
    [586, FORM.noEnds],
    [543, FORM.noEnds],
    [542, FORM.noSize],
    [487, FORM.noSize],
    [486, FORM.views],
    [427, FORM.views],
    [426, FORM.noReserve],
  ])('at %i px, a 3-character total, with References', (width, form) => {
    expect(canvasHeaderLayout(width, true, '123')).toEqual(form);
  });

  it.each([
    [915, FORM.labels],
    [914, FORM.icons],
    [667, FORM.icons],
    [666, FORM.noEnds],
  ])('at %i px, a 7-character total, with References', (width, form) => {
    expect(canvasHeaderLayout(width, true, '123,456')).toEqual(form);
  });

  it('with no total given, reserves only the label text around the figures', () => {
    expect(canvasHeaderLayout(622, false)).toEqual(FORM.labels);
    expect(canvasHeaderLayout(621, false)).toEqual(FORM.icons);
  });

  it('with no measured width (no layout), keeps the labels', () => {
    expect(canvasHeaderLayout(null)).toEqual(FORM.labels);
    expect(canvasHeaderLayout(null, true, '123,456')).toEqual(FORM.labels);
  });

  // The rule is enforced by the signature: the width decides, whatever else is known is a size.
  it('takes the width first, the rest only as sizes', () => {
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
