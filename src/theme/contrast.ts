// Pure WCAG 2.x contrast-ratio helpers (T153). No Node/DOM imports — renderer
// purity requires this file be importable from the renderer bundle *and* from
// a plain Node unit test (tests/unit/theme-contrast.spec.ts) that parses the
// live src/index.css theme tokens and checks them against these formulas.

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parses `#rgb`, `#rrggbb`, or `rgb(a)(r, g, b[, a])` into 0-255 channels + a 0-1 alpha. */
export function parseColor(color: string): RGBA {
  const trimmed = color.trim();

  const hex = trimmed.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (hex) {
    // Expand shorthand #rgb -> #rrggbb so a future token in that form doesn't throw.
    const hexStr =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((c) => c + c)
            .join('')
        : hex[1];
    const n = Number.parseInt(hexStr, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i,
  );
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] !== undefined ? Number(rgba[4]) : 1,
    };
  }

  throw new Error(`parseColor: unsupported color format "${color}"`);
}

function channelToLinear(c: number): number {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an opaque RGB color (0-255 channels). */
export function relativeLuminance(rgb: RGB): number {
  const r = channelToLinear(rgb.r);
  const g = channelToLinear(rgb.g);
  const b = channelToLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Alpha-composites `fg` (with alpha) over an opaque `bg`, returning an opaque RGB. */
export function blend(fg: RGBA, bg: RGB): RGB {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
}

/** WCAG contrast ratio between two opaque colors; result is always >= 1. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
