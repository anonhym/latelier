/**
 * Positioning helper for floating panels anchored to a rect. Tries the
 * preferred side first, flips to the opposite side on overflow, then falls
 * back to below / above. Clamps into the viewport when no candidate fits.
 */

/** Shared panel footprint used by the autocomplete side panel, AddStagePill,
 *  and OperatorTooltip. Height is an upper bound — the panel's own max-height
 *  clamps taller content. */
export const OPERATOR_PANEL_SIZE = { width: 340, height: 360 };

export type Placement = 'right' | 'left' | 'below' | 'above';

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface PlacementResult {
  top: number;
  left: number;
  placement: Placement;
}

const GAP = 8;
const MARGIN = 8;

function opposite(p: Placement): Placement {
  switch (p) {
    case 'right':
      return 'left';
    case 'left':
      return 'right';
    case 'below':
      return 'above';
    case 'above':
      return 'below';
  }
}

function placeFor(anchor: Rect, panel: Size, p: Placement): { top: number; left: number } {
  switch (p) {
    case 'right':
      return { top: anchor.top, left: anchor.left + anchor.width + GAP };
    case 'left':
      return { top: anchor.top, left: anchor.left - panel.width - GAP };
    case 'below':
      return { top: anchor.top + anchor.height + GAP, left: anchor.left };
    case 'above':
      return { top: anchor.top - panel.height - GAP, left: anchor.left };
  }
}

function fits(
  top: number,
  left: number,
  panel: Size,
  vw: number,
  vh: number,
): boolean {
  return (
    left >= MARGIN &&
    left + panel.width <= vw - MARGIN &&
    top >= MARGIN &&
    top + panel.height <= vh - MARGIN
  );
}

export function placeFloatingPanel(
  anchor: Rect,
  panel: Size,
  prefer: Placement,
  viewport?: { width: number; height: number },
): PlacementResult {
  const vw = viewport?.width ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const vh = viewport?.height ?? (typeof window !== 'undefined' ? window.innerHeight : 768);

  const seen = new Set<Placement>();
  const order: Placement[] = [];
  for (const p of [prefer, opposite(prefer), 'below', 'above'] as Placement[]) {
    if (!seen.has(p)) {
      seen.add(p);
      order.push(p);
    }
  }

  for (const p of order) {
    const { top, left } = placeFor(anchor, panel, p);
    if (fits(top, left, panel, vw, vh)) {
      return { top, left, placement: p };
    }
  }

  // Nothing fits — use preferred placement, clamped into viewport.
  const { top, left } = placeFor(anchor, panel, prefer);
  const maxLeft = Math.max(MARGIN, vw - MARGIN - panel.width);
  const maxTop = Math.max(MARGIN, vh - MARGIN - panel.height);
  return {
    top: Math.min(Math.max(top, MARGIN), maxTop),
    left: Math.min(Math.max(left, MARGIN), maxLeft),
    placement: prefer,
  };
}
