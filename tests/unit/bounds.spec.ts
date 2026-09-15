import { describe, it, expect } from 'vitest';

/**
 * Isolated copy of boundsAreOnScreen so we can unit-test the policy without
 * loading Electron. Keep in sync with electron/main.ts; any divergence is a
 * bug in itself.
 */
interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boundsAreOnScreen(b: Bounds, displays: Array<{ workArea: WorkArea }>): boolean {
  for (const d of displays) {
    const wa = d.workArea;
    if (
      b.x >= wa.x - 80 &&
      b.x <= wa.x + wa.width - 80 &&
      b.y >= wa.y - 80 &&
      b.y <= wa.y + wa.height - 80
    ) {
      return true;
    }
  }
  return false;
}

describe('boundsAreOnScreen', () => {
  const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const secondary = { workArea: { x: 1920, y: 0, width: 1280, height: 800 } };

  it('accepts bounds fully on primary', () => {
    expect(boundsAreOnScreen({ x: 100, y: 100, width: 800, height: 600 }, [primary])).toBe(true);
  });

  it('accepts bounds on secondary display', () => {
    expect(
      boundsAreOnScreen({ x: 2000, y: 100, width: 800, height: 600 }, [primary, secondary]),
    ).toBe(true);
  });

  it('rejects bounds fully offscreen', () => {
    expect(boundsAreOnScreen({ x: -5000, y: -5000, width: 800, height: 600 }, [primary])).toBe(false);
    expect(boundsAreOnScreen({ x: 5000, y: 0, width: 800, height: 600 }, [primary])).toBe(false);
  });

  it('accepts slightly off-edge positions (80px slack)', () => {
    expect(boundsAreOnScreen({ x: -50, y: 0, width: 800, height: 600 }, [primary])).toBe(true);
  });
});
