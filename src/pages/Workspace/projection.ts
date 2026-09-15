// Formatting / parsing for the QueryBar's PROJECTION cell. Lives outside
// QueryBar.tsx so the helpers can be unit-tested without bundling React,
// and so the QueryBar module stays single-export-component for fast-refresh.

import { isEjsonDocument } from '../../utils/ejson';

export function formatProjection(projection: string[]): string {
  if (projection.length === 0) return '';
  return `{ ${projection.map((f) => `${f}: 1`).join(', ')} }`;
}

// Why a projection was refused. The two causes call for different user
// actions, so the QueryBar can say which one happened (W14 §3):
//   - 'malformed'   — the text isn't a projection at all; fix the text.
//   - 'unmodelable' — a real projection BuilderState can't express (an
//                     exclusion, `$slice`). That is no longer a
//                     dead end: `isRawProjection` below decides whether the
//                     same text can go to the driver verbatim instead.
export type ProjectionFailure = 'malformed' | 'unmodelable';

export type ProjectionParse =
  | { ok: true; fields: string[] }
  | { ok: false; reason: ProjectionFailure };

// Accepts strict JSON `{"a":1,"b":1}`, mongo-shell `{a: 1, b: 1}`, or bare
// comma lists `a, b, c`. Refuses — rather than parsing lossily — anything
// with an explicit non-inclusion value (e.g. `{a: 0}`, `{a: false}`,
// `$slice`), so the caller keeps the user's draft text instead of silently
// dropping fields. BuilderState.projection only models inclusions.
export function parseProjection(text: string): ProjectionParse {
  const t = text.trim();
  if (!t) return { ok: true, fields: [] };
  try {
    const obj = JSON.parse(t) as unknown;
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const fields: string[] = [];
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        // Valid JSON, so whatever the value is it was typed deliberately —
        // 0 / false / {$slice} are projections we can't model, not typos.
        if (v !== 1 && v !== true) return { ok: false, reason: 'unmodelable' };
        fields.push(k);
      }
      return { ok: true, fields };
    }
  } catch {
    // Fall through to lenient parsing.
  }
  const stripped = t.replace(/^\{|\}$/g, '').trim();
  if (!stripped) return { ok: true, fields: [] };
  const fields: string[] = [];
  for (const part of stripped.split(',')) {
    const [rawK, rawV] = part.split(':').map((s) => s.trim());
    if (!rawK) continue;
    const k = rawK.replace(/^["']|["']$/g, '');
    if (rawV === undefined || rawV === '1' || rawV === 'true') {
      fields.push(k);
    } else if (rawV === '') {
      // `{a: }` — a colon with nothing after it is a half-typed field, not a
      // projection this editor can't model.
      return { ok: false, reason: 'malformed' };
    } else {
      return { ok: false, reason: 'unmodelable' };
    }
  }
  // Nothing survived (`,,,`): not a field list by any reading.
  return fields.length > 0 ? { ok: true, fields } : { ok: false, reason: 'malformed' };
}

/**
 * W15 §2.1/§2.2 — can this text be a `builder.projectionRaw`?
 *
 * The escape hatch for everything the inclusion model refuses: `{"_id": 0}`,
 * `$slice`, mixed documents. The bar is exactly the filter's — it must parse
 * as an EJSON *document* — so the two raw fields have one rule between them
 * rather than two, and a raw projection is never stored in a state the driver
 * would reject. Arrays and scalars are out: `find` takes a document.
 *
 * "One rule between them" is now literal — the shape test was lifted into
 * `isEjsonDocument`, which `sortProblem` calls too.
 */
export function isRawProjection(text: string): boolean {
  return isEjsonDocument(text);
}
