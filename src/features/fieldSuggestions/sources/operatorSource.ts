import type { FieldSource, OperatorSuggestion } from '../types';
import { OPERATORS } from '../operators';

/**
 * Static operator-name source. Sync, pure; returns every catalog entry wrapped
 * as an `OperatorSuggestion`. Context-aware filtering/downranking is applied
 * later when `ctx.operatorContext` is set (Phase B).
 */

// The no-context output is a pure function of the (frozen) catalog, so cache
// it. Typing autocomplete probes this source on every keystroke — re-
// allocating 200+ suggestion objects each time is wasted work.
const BASE_SUGGESTIONS: readonly OperatorSuggestion[] = OPERATORS.map((op) => ({
  kind: 'operator' as const,
  name: op.name,
  class: op.class,
  summary: op.summary,
  label: op.label,
  symbol: op.symbol,
  description: op.description,
  syntax: op.syntax,
  example: op.example,
  url: op.url,
  source: 'operators',
  offContext: false,
}));

export const operatorSource: FieldSource = (ctx) => {
  const wanted = ctx.operatorContext;
  if (!wanted) return BASE_SUGGESTIONS.slice();
  const out: OperatorSuggestion[] = [];
  for (let i = 0; i < OPERATORS.length; i++) {
    const op = OPERATORS[i]!;
    const base = BASE_SUGGESTIONS[i]!;
    const offContext = !!op.validIn && !op.validIn.includes(wanted);
    out.push(offContext ? { ...base, offContext: true } : base);
  }
  return out;
};
