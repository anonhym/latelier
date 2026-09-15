import { describe, expect, it } from 'vitest';
import {
  BUILDER_COLLAPSED_PCT,
  BUILDER_MIN_PCT,
  isUserChosenBuilderSplit,
} from '../../src/pages/Workspace/panelSizes';

/**
 * Hardening for a real regression. The drawer's actual defect was `expand()` restoring the rail
 * width, covered by `tests/e2e/builder-collapse-width.e2e.ts`; the persisted
 * split was measured and never corrupted, so this guard replaces a bad rule
 * rather than repairing damage.
 *
 * Unit tests rather than component ones on purpose. jsdom has no layout engine,
 * so `react-resizable-panels` never produces the collapsed layout there — a
 * component test that toggles the drawer writes the *seeded* value and passes
 * identically against the broken code. One was written, observed to pass
 * against the bug, and deleted. That is the failure mode this guards against,
 * so the rule is tested where it is decidable and the behaviour in Electron.
 */
describe('isUserChosenBuilderSplit', () => {
  it('rejects the collapsed rail width', () => {
    // The whole bug in one assertion: 4 is not 0, so the old `< 1` test let it
    // through and it was written to the user's stored split.
    expect(isUserChosenBuilderSplit(BUILDER_COLLAPSED_PCT)).toBe(false);
  });

  it('rejects anything below the draggable minimum', () => {
    expect(isUserChosenBuilderSplit(0)).toBe(false);
    expect(isUserChosenBuilderSplit(1)).toBe(false);
    expect(isUserChosenBuilderSplit(BUILDER_MIN_PCT - 0.01)).toBe(false);
  });

  it('accepts the minimum and anything above it', () => {
    expect(isUserChosenBuilderSplit(BUILDER_MIN_PCT)).toBe(true);
    expect(isUserChosenBuilderSplit(26)).toBe(true);
    expect(isUserChosenBuilderSplit(70)).toBe(true);
  });

  it('rejects a missing or non-finite size', () => {
    expect(isUserChosenBuilderSplit(undefined)).toBe(false);
    expect(isUserChosenBuilderSplit(NaN)).toBe(false);
    expect(isUserChosenBuilderSplit(Infinity)).toBe(false);
  });

  // The rail must stay below the minimum, or the guard cannot tell a collapse
  // from a drag and the bug comes straight back.
  it('keeps the rail below the draggable minimum', () => {
    expect(BUILDER_COLLAPSED_PCT).toBeLessThan(BUILDER_MIN_PCT);
  });
});
