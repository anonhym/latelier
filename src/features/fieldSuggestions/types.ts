import type { DisplayType } from '../../utils/displayValue';
import type { OperatorClass, OperatorContext } from './operators';

/**
 * Shared context passed to every source. `target` discriminates the kind of
 * suggestion the caller wants: absent → field names, present → values for
 * the specified field (optionally narrowed by operator).
 */
export interface SuggestionContext {
  connectionId: string;
  dbName: string;
  collection: string;
  /** Docs the caller already has on hand (e.g., the current tab's lastRun). */
  recentDocs?: unknown[];
  /** When set, sources emit value suggestions for this field. */
  target?: { field: string; operator?: string };
  /** Phase B: filter/rank operator suggestions by where the caret sits. */
  operatorContext?: OperatorContext;
}

export interface FieldSuggestion {
  kind: 'field';
  path: string;
  type?: DisplayType;
  source: string;
  /** How often the path appeared in the sample. Higher = more common. */
  frequency?: number;
}

export interface ValueSuggestion {
  kind: 'value';
  value: unknown;
  /** Human-readable rendering for the popover. */
  display: string;
  type?: DisplayType;
  source: string;
  frequency?: number;
}

export interface OperatorSuggestion {
  kind: 'operator';
  /** Always $-prefixed, e.g. '$eq'. */
  name: string;
  class: OperatorClass;
  summary?: string;
  /** Short English name and typed symbol (ADR 0004). Query operators only. */
  label?: string;
  symbol?: string;
  source: string;
  /** Phase B: set when the op is outside the caret's context — used to downrank. */
  offContext?: boolean;
  /** Rich-docs fields (X04). Populated from the catalog. */
  description?: string;
  syntax?: string;
  example?: string;
  url?: string;
}

export type Suggestion = FieldSuggestion | ValueSuggestion | OperatorSuggestion;

/** A key-position source: emits field names or operator names at a bare-key site. */
export type FieldSource = (
  ctx: SuggestionContext,
) =>
  | Array<FieldSuggestion | OperatorSuggestion>
  | Promise<Array<FieldSuggestion | OperatorSuggestion>>;

export type ValueSource = (
  ctx: SuggestionContext & { target: { field: string; operator?: string } },
) => ValueSuggestion[] | Promise<ValueSuggestion[]>;
