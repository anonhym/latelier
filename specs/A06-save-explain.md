# A06 — Save pipeline / save as collection / explain

## Purpose

Three closely-related title-bar actions that extend the aggregation tab beyond "run + display": persisting a named pipeline for reuse, writing pipeline output to a new collection (via `$out`), and inspecting the query-planner's execution plan.

## Scope

- **In**: Save / Save as (thin wrapper around W09), Save as collection modal + server action, Explain drawer + runner.
- **Out**: Saved-queries storage (W09), runner internals (A04).

## Dependencies

- W09, A01, A04, F05.

## 1. Save / Save as

Covered operationally in A01 §4 and W09 §5. Recap:
- Aggregation payload shape: `{ kind: 'aggregation', stages }`.
- Save uses `saved:update` if `savedId` is set, else falls through to Save as.
- Save as opens the W09 modal with `kind: 'aggregation'` preset.
- On success, tab state updates `{ savedId, name, dirty: false }`.

No new IPC surface.

## 2. Save as collection

Writes the pipeline result to a target collection by appending a `$out` stage (or `$merge` if chosen) and re-running.

### Modal

Triggered from the output panel's "Save as…" button or a pipeline-level action "Save results to collection".

Fields:
- **Target database** (select; default is current dbName).
- **Target collection** (text; validation: Mongo naming rules).
- **Mode**:
  - `$out` — replace collection contents atomically (default).
  - `$merge` — merge using `_id`. Shows advanced fields (`whenMatched`, `whenNotMatched`) when selected.
- **Warning banner**:
  - `$out`: "This replaces all documents in the target collection."
  - `$merge`: "Existing documents with matching `_id` will be replaced/updated; non-matching documents will be inserted."
- **Confirm button**: requires typing the target collection name (same pattern as W08 bulk delete).

### Server action

```ts
// IPC channel
'agg:runAndSave'  (AggInput + { target: { dbName, collection, mode: '$out'|'$merge'; merge?: MergeOptions } })
  → AggResult
```

Implementation:
- Append `{ $out: "coll" }` or `{ $merge: { into: "coll", whenMatched, whenNotMatched } }` to the user's pipeline.
- Call `agg:run` with `allowWrite: true`.
- The resulting `AggResult.rows` is empty for `$out`/`$merge` (they don't return documents); the UI shows a success banner "Wrote N documents to {db}.{coll}" (N via `countDocuments` post-run).
- The pipeline stored in the tab does NOT get the write stage appended; this is a one-shot run. If the user wants to persist the write, they can add the stage themselves via A03.

### Error handling

- Invalid target collection name → VALIDATION.
- `Unauthorized` → UNAUTHORIZED banner explaining the user lacks `insert` / `update` privileges.
- Namespace conflict (target equals source with `$out`) → CONFLICT.

## 3. Explain

Triggered by the title-bar Explain button or `⌘E`.

### IPC channel

| Channel       | Input                                   | Output              |
| ------------- | --------------------------------------- | ------------------- |
| `agg:explain` | `AggInput + { verbosity }`              | `{ plan: unknown }` |

`verbosity`: `queryPlanner` (default) | `executionStats` | `allPlansExecution`.

Server implementation:
- `collection.aggregate(pipeline).explain(verbosity)`.
- Strips sensitive fields from the plan before returning (none currently, but the hook exists).
- Skips write stages in the pipeline when generating explain (silently removes `$out`/`$merge` before calling; documented in the drawer).

### Drawer UI

- Slide-in from the right, 520 px wide, full height.
- Header: title, verbosity selector, close.
- Body: syntax-highlighted EJSON of the explain plan, with expand/collapse buttons for nested sections.
- Footer: `Copy` (clipboard), `Download` (save JSON file).
- A small "Stages with write ops were omitted" notice if applicable.

### Performance

- Explain queries can be as expensive as the real run for `executionStats`+. The drawer shows a spinner; cancellation button aborts via `agg:cancel` keyed on a new token.

## 4. Acceptance criteria

- [ ] Save/Save as delegate to W09 correctly; tab state updates reflect saved status.
- [ ] Save as collection with `$out` replaces the target collection's contents; a banner reports the new count.
- [ ] `$merge` mode respects `whenMatched`/`whenNotMatched`.
- [ ] Target equals source with `$out` is rejected before running.
- [ ] Explain drawer renders a plan for `queryPlanner` on a seeded collection.
- [ ] Explain with `$out`/`$merge` in the pipeline succeeds and shows the omission notice.

## 5. Test cases

### Integration (memory Mongo)
- **out-happy.spec.ts**: seed source coll; run agg:runAndSave with `$out`; target coll now has expected docs.
- **merge.spec.ts**: pre-existing target doc gets merged on matching `_id`; non-matching inserted.
- **target-equals-source.spec.ts**: CONFLICT.
- **unauthorized.spec.ts**: read-only user → UNAUTHORIZED.
- **explain-queryplanner.spec.ts**: call explain → `plan.stages` present.
- **explain-strips-write-stage.spec.ts**: pipeline with `$out` → explain runs without writing; response flagged with omission note.

### Component
- **save-as-collection-modal.spec.tsx**: require name typed to enable Confirm; submitting calls `api.agg.runAndSave`.
- **explain-drawer.spec.tsx**: click Explain → drawer opens; verbosity toggle re-fetches.
- **explain-copy-download.spec.tsx**: Copy writes to clipboard; Download calls `app:saveFile`.

### E2E
- **agg-full-flow.e2e.ts**: open agg tab → build pipeline → Run → Save (enters modal) → Save as collection → verify new collection exists → Explain → drawer visible with plan.
