/** The palette's width, which the Spotlight root is given. */
export const PALETTE_WIDTH = 640;
/** The gap between the title-bar field and the palette's top edge. */
export const ANCHOR_GAP = 4;
/** The room kept between the palette and the window's sides. */
export const ANCHOR_MARGIN = 8;

export interface AnchorBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Where the anchored palette's top-left corner goes (X07 §14.1): its top edge
 * just under `field`, centred on it and kept inside the window. Null, meaning
 * centred as before, when there is no field to anchor to (not drawn, or not on
 * this screen) or the window is too narrow to hold the palette beside its margins.
 */
export function anchorPosition(
  field: AnchorBox | null,
  viewportWidth: number,
): { top: number; left: number } | null {
  if (!field || field.width <= 0 || field.height <= 0) return null;
  if (viewportWidth < PALETTE_WIDTH + 2 * ANCHOR_MARGIN) return null;
  const centred = field.left + field.width / 2 - PALETTE_WIDTH / 2;
  const left = Math.min(Math.max(centred, ANCHOR_MARGIN), viewportWidth - PALETTE_WIDTH - ANCHOR_MARGIN);
  return { top: field.bottom + ANCHOR_GAP, left };
}

/** The title bar's search field, measured now; the palette is anchored to it. */
export function measurePaletteAnchor(): { top: number; left: number } | null {
  const el = document.querySelector('[data-palette-anchor]');
  return anchorPosition(el ? el.getBoundingClientRect() : null, window.innerWidth);
}
