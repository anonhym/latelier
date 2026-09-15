import { describe, it, expect } from 'vitest';
import { placeFloatingPanel } from '../../src/features/fieldSuggestions/placement';

const VIEWPORT = { width: 1200, height: 800 };

describe('placeFloatingPanel', () => {
  it('returns preferred "right" when there is room', () => {
    const anchor = { top: 200, left: 300, width: 200, height: 40 };
    const panel = { width: 340, height: 360 };
    const r = placeFloatingPanel(anchor, panel, 'right', VIEWPORT);
    expect(r.placement).toBe('right');
    expect(r.left).toBe(300 + 200 + 8);
    expect(r.top).toBe(200);
  });

  it('flips to "left" when the right edge would overflow', () => {
    const anchor = { top: 100, left: 1000, width: 100, height: 40 };
    const panel = { width: 340, height: 300 };
    const r = placeFloatingPanel(anchor, panel, 'right', VIEWPORT);
    expect(r.placement).toBe('left');
    expect(r.left).toBe(1000 - 340 - 8);
  });

  it('falls back to "below" when both sides are too narrow', () => {
    const anchor = { top: 20, left: 20, width: 1000, height: 40 };
    const panel = { width: 340, height: 200 };
    const r = placeFloatingPanel(anchor, panel, 'right', VIEWPORT);
    expect(r.placement).toBe('below');
    expect(r.top).toBe(20 + 40 + 8);
    expect(r.left).toBe(20);
  });

  it('falls back to "above" when below would overflow', () => {
    const anchor = { top: 600, left: 20, width: 1160, height: 40 };
    const panel = { width: 340, height: 300 };
    const r = placeFloatingPanel(anchor, panel, 'right', VIEWPORT);
    expect(r.placement).toBe('above');
    expect(r.top).toBe(600 - 300 - 8);
  });

  it('clamps coordinates when nothing fits', () => {
    const anchor = { top: 10, left: 10, width: 50, height: 20 };
    const panel = { width: 2000, height: 2000 };
    const r = placeFloatingPanel(anchor, panel, 'right', VIEWPORT);
    expect(r.placement).toBe('right');
    // Even though nothing fits, coords should be clamped to at least the
    // top-left margin.
    expect(r.top).toBeGreaterThanOrEqual(8);
    expect(r.left).toBeGreaterThanOrEqual(8);
  });

  it('uses the caller-supplied viewport size', () => {
    const small = { width: 400, height: 300 };
    const anchor = { top: 50, left: 50, width: 100, height: 40 };
    const panel = { width: 340, height: 300 };
    // Right fits at left=158 (50+100+8), right edge at 498 — exceeds 400.
    // Left fits at left = -298 — negative. Below fits at top = 98, bottom = 398
    // — exceeds 300. Above: top = 50-300-8 = -258 — negative. Nothing fits
    // → clamped.
    const r = placeFloatingPanel(anchor, panel, 'right', small);
    expect(r.placement).toBe('right');
    expect(r.top).toBeGreaterThanOrEqual(8);
    expect(r.left).toBeGreaterThanOrEqual(8);
  });

  it('respects the "below" preference when right fits too', () => {
    const anchor = { top: 100, left: 100, width: 200, height: 40 };
    const panel = { width: 340, height: 100 };
    const r = placeFloatingPanel(anchor, panel, 'below', VIEWPORT);
    expect(r.placement).toBe('below');
  });
});
