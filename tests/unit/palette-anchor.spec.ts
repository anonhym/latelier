import { describe, expect, it } from 'vitest';
import { ANCHOR_GAP, ANCHOR_MARGIN, PALETTE_WIDTH, anchorPosition } from '../../src/commands/paletteAnchor';

const field = { left: 700, bottom: 33, width: 320, height: 26 };

describe('anchorPosition', () => {
  it('puts the top edge just under the field and centres on it', () => {
    expect(anchorPosition(field, 1600)).toEqual({ top: 33 + ANCHOR_GAP, left: 700 + 160 - PALETTE_WIDTH / 2 });
  });

  it('keeps the palette inside the window on the right and on the left', () => {
    expect(anchorPosition({ ...field, left: 1500 }, 1600)).toEqual({
      top: 37,
      left: 1600 - PALETTE_WIDTH - ANCHOR_MARGIN,
    });
    expect(anchorPosition({ ...field, left: 0 }, 1600)).toEqual({ top: 37, left: ANCHOR_MARGIN });
  });

  it('is null without a field, or one that is not drawn', () => {
    expect(anchorPosition(null, 1600)).toBeNull();
    expect(anchorPosition({ ...field, width: 0 }, 1600)).toBeNull();
    expect(anchorPosition({ ...field, height: 0 }, 1600)).toBeNull();
  });

  it('is null when the window cannot hold the palette beside its margins', () => {
    expect(anchorPosition(field, PALETTE_WIDTH + 2 * ANCHOR_MARGIN - 1)).toBeNull();
    expect(anchorPosition(field, PALETTE_WIDTH + 2 * ANCHOR_MARGIN)).toEqual({ top: 37, left: ANCHOR_MARGIN });
  });
});
