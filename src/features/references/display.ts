import type { ReferenceRule } from '@shared/types';
import { toDisplayValue } from '../../utils/displayValue';

/** Unique per push so re-clicking the same ref still stacks. */
export function makeFrameId(rule: ReferenceRule): string {
  return `${rule.id}:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * True when a click should be treated as "already showing this reference"
 * and skipped. Compares by rule id + EJSON-shape equality of the value.
 */
export function isSameReferenceTarget(
  frame: { rule: ReferenceRule; value: unknown } | undefined,
  rule: ReferenceRule,
  value: unknown,
): boolean {
  if (!frame) return false;
  if (frame.rule.id !== rule.id) return false;
  return JSON.stringify(frame.value) === JSON.stringify(value);
}

/**
 * Expand `{field.path}` placeholders in a display template against a resolved
 * (EJSON-encoded) document. Missing paths render as empty.
 */
export function renderDisplayTemplate(
  template: string,
  doc: Record<string, unknown>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_, path: string) => {
    const parts = path.split('.');
    let current: unknown = doc;
    for (const p of parts) {
      if (current === null || typeof current !== 'object') return '';
      current = (current as Record<string, unknown>)[p];
    }
    if (current === null || current === undefined) return '';
    if (typeof current === 'object') {
      // Delegate to toDisplayValue for canonical EJSON sentinels — covers
      // $oid/$date/$numberInt/$numberDouble/$numberLong/$numberDecimal/$regex/
      // $binary uniformly. Plain nested objects/arrays still fall back to
      // JSON since they have no useful one-line form.
      const dv = toDisplayValue(current);
      if (dv.type === 'object' || dv.type === 'array' || dv.type === 'binary') {
        return JSON.stringify(current);
      }
      return dv.display;
    }
    return String(current);
  });
}
