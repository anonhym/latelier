# A02 — Pipeline outline + model

## Purpose

Define the `Stage` data model used throughout aggregation, validate it, and render the left-side outline that shows the pipeline as a labeled vertical flow (source → stage → stage → … → output) with per-stage document counts.

## Scope

- **In**: `Stage` type, pipeline-level operations (add, remove, reorder, toggle, update body), outline component, selection handoff to Stage accordion.
- **Out**: Stage editor UI (A03), stage-preview computation (A04 §4), save/explain (A06).

## Dependencies

- W01, A01, A04 (for counts).

## 1. Model

```ts
// shared/types.ts
export type StageOp =
  | '$match' | '$group' | '$sort' | '$project' | '$addFields'
  | '$limit' | '$skip' | '$count' | '$lookup' | '$unwind'
  | '$replaceRoot' | '$redact' | '$out' | '$merge'
  | '$set' | '$unset';      // common modern aliases

export interface Stage {
  id: number;
  op: StageOp | string;      // allow unknown op strings; validator warns
  body: string;              // EJSON string (either an object body or a primitive)
  enabled: boolean;
  note?: string;             // optional user annotation
}
```

### Pipeline operations

```ts
export interface PipelineState {
  stages: Stage[];
  activeStageId: number | null;
}

function addStage(s: PipelineState, op: StageOp, afterIndex?: number): PipelineState;
function removeStage(s: PipelineState, id: number): PipelineState;
function moveStage(s: PipelineState, from: number, to: number): PipelineState;
function setBody(s: PipelineState, id: number, body: string): PipelineState;
function toggleEnabled(s: PipelineState, id: number): PipelineState;
function duplicateStage(s: PipelineState, id: number): PipelineState;
```

Pure functions; unit-testable.

## 2. Validation

Per stage:
- `op` must be a non-empty string; warn if not in the known list (UI shows a yellow pill "Unknown op").
- `body` must be a valid EJSON string. `$limit`, `$skip`, `$count`, `$unwind` accept primitive bodies (number, string, number, string respectively); others expect objects.
- `$out` and `$merge` are flagged as write stages (`isWriteStage(op)`); Run treats them specially (A04 §6).

Pipeline-level:
- `stages.filter(s => s.enabled)` must be non-empty to Run.
- If any stage has invalid body, Run is disabled and the offending stage shown with a warn outline.

Helper `validatePipeline(stages): { ok: boolean; errors: Array<{id, reason}> }`.

## 3. Outline component

### Visual structure

```
┌─────────────────┐
│  Pipeline       │   (header: active count, output count)
│  ─────────────  │
│  📚 source      │   (source collection row with total count)
│   |             │
│  1. $match  •   │   (• = active)   124,880
│   |             │
│  2. $group      │    4,204
│   ⋮             │
│  →  Output  5   │
│                 │
│  ─── stats ───  │
│  Source: …      │
│  Stages: 4      │
│  Output: 5      │
└─────────────────┘
```

### Rows
- Source row: db + collection icon, total count via `pool.serverInfo` or direct `countDocuments` if not cached (lazy).
- Stage rows: index, op badge (color-coded via `OP_COLOR`), count from `stageCounts[id]`, dot highlights active stage.
- Output row: the count of docs produced by the last run.
- Disabled stages: render at 50% opacity.

### Interactions
- Click a stage row → selects + scrolls the accordion to that stage.
- Drag handle on the left: reorders. On drop, `moveStage` + sync.
- Right-click a stage: `Enable/Disable`, `Duplicate`, `Delete`, `Jump to`.

### Colors

Reuse existing `OP_COLOR` map (from `Aggregation.tsx`). Extend for `$replaceRoot`, `$set`, `$unset`, `$merge`, `$out` with new palette entries.

## 4. Persistence

`stages`, `activeStageId` stored in `AggregationTabState.stages` / `.activeStageId`. Every change writes through `tabs:update` (debounced by W01's 250ms rule).

## 5. Stage counts

- Stage counts are populated by a successful Run (A04): each stage id maps to count after that stage.
- Between runs (e.g., after editing), counts for edited stages become stale. The outline shows the old count with a tiny ⚠ icon indicating "stale". On next Run it refreshes.

## 6. Acceptance criteria

- [ ] Adding a stage via `addStage` produces a unique id and positions correctly when `afterIndex` is given.
- [ ] Disabled stages are excluded from execution but remain in the outline.
- [ ] Reordering persists across tab switches and relaunches.
- [ ] Validation marks stages with invalid EJSON and disables Run.
- [ ] Known unknown ops render a warning badge but don't block Run (server will reject, and the error surfaces in the error panel).
- [ ] Stage-count staleness is visually signaled after edits.

## 7. Test cases

### Unit
- **pipeline-ops.spec.ts**: each pure function; including edge cases like moveStage out-of-bounds.
- **validate-pipeline.spec.ts**: table-driven — valid, invalid EJSON, primitive-ok ops, unknown op.

### Component
- **outline-render.spec.tsx**: mocks a state with 3 stages → renders source + 3 rows + output; colored badges match op.
- **click-selects.spec.tsx**: click a row → `api.tabs.update` called with new `activeStageId`.
- **drag-reorder.spec.tsx**: simulate drag → reorder; persisted state mirrors new order.
- **disabled-opacity.spec.tsx**: a disabled stage renders at 0.5 opacity and its count strikes through.
