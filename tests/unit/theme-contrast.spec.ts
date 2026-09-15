import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseColor, relativeLuminance, blend, contrastRatio } from '../../src/theme/contrast';

// Parses the live src/index.css theme blocks — the source of truth — rather
// than duplicating token literals in the test, so a future token edit that
// regresses contrast is caught here without the test needing to change.
const INDEX_CSS = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'index.css'),
  'utf8',
);

/** Extracts the `{ ... }` body of the first rule whose selector contains `marker`. */
function extractBlock(css: string, marker: string): string {
  const markerIndex = css.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(`extractBlock: marker "${marker}" not found in index.css`);
  }
  const openBrace = css.indexOf('{', markerIndex);
  const closeBrace = css.indexOf('}', openBrace);
  if (openBrace === -1 || closeBrace === -1) {
    throw new Error(`extractBlock: malformed rule near marker "${marker}"`);
  }
  return css.slice(openBrace + 1, closeBrace);
}

/** Reads a single `--custom-property: value;` declaration's raw value out of a CSS block. */
function readVar(block: string, name: string): string {
  const re = new RegExp(`${name}\\s*:\\s*([^;]+);`);
  const m = block.match(re);
  if (!m) {
    throw new Error(`readVar: "${name}" not found in block`);
  }
  return m[1].trim();
}

const lightBlock = extractBlock(INDEX_CSS, '[data-mantine-color-scheme="light"]');
const darkBlock = extractBlock(INDEX_CSS, '[data-mantine-color-scheme="dark"]');

const THEMES = {
  light: {
    block: lightBlock,
    surfaces: ['--atelier-bg', '--atelier-surface', '--atelier-surface-raised', '--atelier-surface-active'],
  },
  dark: {
    block: darkBlock,
    surfaces: ['--atelier-bg', '--atelier-surface', '--atelier-surface-raised', '--atelier-surface-active'],
  },
} as const;

const TOKENS = {
  muted: { varName: '--atelier-text-muted', minRatio: 4.5 },
  ghost: { varName: '--atelier-text-ghost', minRatio: 3 },
} as const;

describe('theme token contrast (WCAG AA, worst-case surface)', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    for (const [tokenName, token] of Object.entries(TOKENS)) {
      const fgRaw = readVar(theme.block, token.varName);
      const fg = parseColor(fgRaw);

      for (const surfaceVar of theme.surfaces) {
        it(`${themeName} ${tokenName} (${token.varName}) over ${surfaceVar} clears ${token.minRatio}:1`, () => {
          const bgRaw = readVar(theme.block, surfaceVar);
          const bg = parseColor(bgRaw);
          const blended = blend(fg, bg);
          const ratio = contrastRatio(blended, bg);
          expect(ratio).toBeGreaterThanOrEqual(token.minRatio);
        });
      }
    }

    it(`${themeName}: muted alpha is higher than ghost alpha`, () => {
      const mutedAlpha = parseColor(readVar(theme.block, TOKENS.muted.varName)).a;
      const ghostAlpha = parseColor(readVar(theme.block, TOKENS.ghost.varName)).a;
      expect(mutedAlpha).toBeGreaterThan(ghostAlpha);
    });

    it(`${themeName}: --mantine-color-dimmed aliases --atelier-text-muted`, () => {
      expect(readVar(theme.block, '--mantine-color-dimmed')).toBe('var(--atelier-text-muted)');
    });
  }
});

describe('contrast.ts helpers', () => {
  it('parseColor handles #rrggbb', () => {
    expect(parseColor('#1a1a2e')).toEqual({ r: 26, g: 26, b: 46, a: 1 });
  });

  it('parseColor expands shorthand #rgb', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#0a3')).toEqual({ r: 0, g: 170, b: 51, a: 1 });
  });

  it('parseColor handles rgba()', () => {
    expect(parseColor('rgba(26,26,46,0.5)')).toEqual({ r: 26, g: 26, b: 46, a: 0.5 });
  });

  it('relativeLuminance of white is 1, black is 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 5);
  });

  it('contrastRatio of black on white is 21:1', () => {
    expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 1);
  });
});
