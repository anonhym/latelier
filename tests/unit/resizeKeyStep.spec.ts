import { describe, it, expect } from 'vitest';
import { resizeKeyStep, RESIZE_STEP } from '../../src/pages/Workspace/resizeKeyStep';

/**
 * Pure arithmetic behind keyboard resize on every `role="separator"` handle
 * (#56). Component tests prove the DOM wiring; this proves the numbers,
 * fast and without a render.
 */
describe('resizeKeyStep', () => {
  it('horizontal: ArrowRight increases by the default step', () => {
    expect(resizeKeyStep('ArrowRight', 'horizontal', 200, 100, 400)).toBe(200 + RESIZE_STEP);
  });

  it('horizontal: ArrowLeft decreases by the default step', () => {
    expect(resizeKeyStep('ArrowLeft', 'horizontal', 200, 100, 400)).toBe(200 - RESIZE_STEP);
  });

  it('vertical: ArrowUp increases, ArrowDown decreases', () => {
    expect(resizeKeyStep('ArrowUp', 'vertical', 200, 80, 800)).toBe(200 + RESIZE_STEP);
    expect(resizeKeyStep('ArrowDown', 'vertical', 200, 80, 800)).toBe(200 - RESIZE_STEP);
  });

  it('horizontal keys are ignored on the vertical axis and vice versa', () => {
    expect(resizeKeyStep('ArrowRight', 'vertical', 200, 80, 800)).toBeNull();
    expect(resizeKeyStep('ArrowUp', 'horizontal', 200, 100, 400)).toBeNull();
  });

  it('clamps an increase at max', () => {
    expect(resizeKeyStep('ArrowRight', 'horizontal', 395, 100, 400)).toBe(400);
    expect(resizeKeyStep('ArrowRight', 'horizontal', 400, 100, 400)).toBe(400);
  });

  it('clamps a decrease at min', () => {
    expect(resizeKeyStep('ArrowLeft', 'horizontal', 105, 100, 400)).toBe(100);
    expect(resizeKeyStep('ArrowLeft', 'horizontal', 100, 100, 400)).toBe(100);
  });

  it('Home jumps to min, End jumps to max', () => {
    expect(resizeKeyStep('Home', 'horizontal', 250, 100, 400)).toBe(100);
    expect(resizeKeyStep('End', 'horizontal', 250, 100, 400)).toBe(400);
  });

  it('an unrelated key returns null so the caller lets it bubble', () => {
    expect(resizeKeyStep('a', 'horizontal', 250, 100, 400)).toBeNull();
    expect(resizeKeyStep('Enter', 'horizontal', 250, 100, 400)).toBeNull();
  });

  it('honors a custom step when the default is not what the caller wants', () => {
    expect(resizeKeyStep('ArrowRight', 'horizontal', 200, 100, 400, 25)).toBe(225);
  });
});
