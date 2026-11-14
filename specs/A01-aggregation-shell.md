# A01 — Aggregation shell + tab routing

> **Status: Implemented.** §1–§8 shipped, with Aggregation as a sub-view of the collection tab, not a tab of its own. §9, the side-by-side layout (a stages column and a preview column, no outline, one Export menu), is built; where it names a part of §2 or §4, §9 is what ships. The stack toggle's choice and the stages column's width are not tab state: they reset when the view remounts.

## Purpose

Wire the existing Aggregation mock as an in-workspace tab type rather than a standalone page. Provides the title-bar actions, the tab lifecycle, and the hosting container that holds the pipeline outline, stage accordion, and output panel.

## Scope

- **In**: Aggregation tab layout, title-bar actions (Save/Save as/Run/Explain), `WorkspaceTab.kind = 'aggregation'` integration, breadcrumb, dark toggle, name/state persistence.
- **Out**: Pipeline model (A02), stage UI (A03), runner (A04), output panel (A05), save/explain mechanics (A06).

## Dependencies

- W01 (tabs), A02–A06.

## 1. Route / containment

- No dedicated URL. Aggregation lives inside `/workspace` as a `kind: 'aggregation'` tab.
- The existing `Aggregation.tsx` file becomes a **component** (`AggregationTab`), not a page; `App.tsx`'s `/aggregation` route is removed.
- Tabs:
  - "Open aggregation on current collection" from W01's new-tab menu creates one.
  - C07's row context menu `Open as aggregation` creates one.
  - Saved aggregation "Open in new tab" (W09) creates one hydrated with stages.

## 2. Layout

```
┌─ Title bar ─────────────────────────────────────────────────────────┐
│ [< Connections]  Conn / db / coll · agg(pipeline name)   [🌙/☀]    │
│                               [Save] [Save as] [Run] [Explain] [Copy]│
├─ Tab strip (shared with workspace) ─────────────────────────────────┤
│ ⚡ journalEntry   Σ monthlyByAccount (×)                    [+▾]    │
├─ Body ──────────────────────────────────────────────────────────────┤
│ ┌─PipelineOutline──┐ ┌─StageAccordion─────────────────────────────┐ │
│ │ source           │ │ source card                                │ │
│ │ stage 1          │ │ AddStagePill                               │ │
│ │ stage 2 (active) │ │ Stage 1 …                                  │ │
│ │ output           │ │ …                                          │ │
│ └──────────────────┘ │                                            │ │
│                      │                                            │ │
│                      ├─Output panel (draggable handle)────────────┤ │
│                      │ Pipeline output · Tree/JSON/Table          │ │
│                      └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## 3. State (subset of `AggregationTabState`, W01)

```ts
{
  name?: string;
  savedId?: string;
  stages: Stage[];
  activeStageId: number | null;
  outputHeight: number;          // px
  outputView: 'Tree' | 'JSON' | 'Table';
  lastRun?: {
    rows: unknown[];             // EJSON
    durationMs: number;
    ranAt: string;
    stageCounts: Record<number, number>;  // stage.id → count after that stage
    error?: IpcError;
  };
  dirty: boolean;
}
```

`dirty` flips when `stages` changes after a save/load. Used for the close-tab confirmation (W01).

## 4. Title bar actions

### Save
- If `savedId` present: `api.saved.update(savedId, { payload: { kind: 'aggregation', stages } })` → `setDirty(false)`.
- Else: same UX as Save as.

### Save as
- Opens Save modal (W09). On success, sets `savedId` + `name` and clears `dirty`.

### Run
- Invokes the runner (A04). Visually kicks off:
  - Disables other Title bar actions while running.
  - Updates outline stage counts and the output panel with results.
- Keyboard `⌘↵`.

### Explain
- Runs the aggregation in explain mode (A06). Opens a side drawer with the explain JSON.
- Keyboard `⌘E`.

### Copy
- A menu, disabled while the pipeline does not validate. "Pipeline (EJSON array)" copies the enabled stages as one Canonical EJSON array; mongosh, Node.js and Python copy an `aggregate` call for that driver.
- Each enabled body is repaired from Shell Syntax first, on a copy: the tab's own bodies are not rewritten. A body that cannot be repaired copies nothing and names the stage by its 1-based position.
- Each stage is a plain literal; each exact EJSON sentinel in it goes through the driver's own EJSON parser (`EJSON.parse(…, { relaxed: false })`, `json_util.loads`), so an ObjectId or a Long keeps its type. Only the sentinel: the drivers' parsers revive looser shapes than the app, such as `{ $regex, $ne }` as a regex. An Int32 or a fractional Double is written as a bare number, which every driver sends as that type.

### Dark toggle
- Reuses the global `DarkToggleCtx` (X01). No special behavior.

## 5. Breadcrumb

Format: `{connection.name} / {dbName} / {collection} · {name ?? 'Unsaved pipeline'}`. Dirty state is indicated by a small dot next to the name.

## 6. Close-tab guard

If `dirty: true` and user closes via `×` or `⌘W`:
- Dialog "Discard pipeline changes? The pipeline has unsaved edits." with `Cancel`, `Discard`, `Save…`. `Save…` opens Save-as modal; on success, close the tab.

## 7. Acceptance criteria

- Aggregation opens as a tab in Workspace, not a separate route.
- Closing the tab with `dirty=true` prompts; `dirty=false` closes silently.
- Save updates an existing saved pipeline; Save as always opens the modal.
- Title bar buttons reflect disabled state while a run is in flight.
- Dark toggle persists across aggregation/collection tabs within the same window.

## 8. Test cases

### Component
- **shell-render.spec.tsx**: hosted inside workspace, title bar breadcrumb reads connection/db/coll/name.
- **save-vs-save-as.spec.tsx**: with `savedId` → Save calls update; without → Save opens modal.
- **run-disables-buttons.spec.tsx**: when running, Save/Save as/Explain disabled; Run becomes Cancel (A04 cancellation).
- **dirty-close-guard.spec.tsx**: modify stages → attempt close → dialog; Save→close; Cancel keeps tab.
- **breadcrumb-dot.spec.tsx**: dirty adds a dot; save clears.

## 9. Amendment — stages beside their preview

> It supersedes §2's layout and the placement of §4's actions. The runner, save and explain behaviour (§4, A04, A06) is unchanged.

The shipped view had a 200px outline that repeated the canvas beside it, a second toolbar with its own Save / Save as / Run / Explain / Copy, and an output panel with another "Save as…" and "Save as view…": two "Save as" with different meanings. With no stages, Run was disabled and nothing said why.

### 9.1 Regions

Below the view header ([W01 §14.5](./W01-workspace-shell.md)):

| Region | Size at 1440×900 | Holds |
| --- | --- | --- |
| Pipeline bar | full width × 44 | `[name ● unsaved]` `[Save ▾]` … `[Explain]` `[Copy ▾]` `[▶ Run ⌘↵]` |
| Stages column | 480 wide, resizable | source chip, stage cards, add stage |
| Preview column | the rest | the output of the selected stage, or the final output |

Below 1100px of window width, or by a toggle in the preview header, the two columns stack (stages above, preview below), which is the old arrangement.

### 9.2 Pipeline bar

- `Save ▾` holds **Save** and **Save as…** (§4's two actions under one control).
- **Run** is the view's only filled button. Explain and `Copy ▾` (§4) are unchanged.
- When Run or Explain is unavailable, its tooltip says why, and the preview column says it too (§9.5).

### 9.3 Stages column

- The column **is** the outline ([A02 §8](./A02-pipeline-outline.md)). Each stage is a card: a 32px header (`drag handle · {n} · {$op} ▾ · enabled switch · ⋯`), the body editor ([A03](./A03-stage-accordion.md)), and a footer `→ {n} documents` when a count is known ([A02 §5](./A02-pipeline-outline.md)).
- A collapsed card is its 32px header, so a long pipeline still reads top to bottom as a list of stages.
- The card's `⋯` holds Move up, Move down, Duplicate, Delete (A03 §3's actions).
- Selecting a card (click its header, or ↑↓ in the column) selects that stage for the preview. A final `Output` row selects the whole pipeline.

### 9.4 Preview column

- It shows the result for the **selection**: the last output of "run up to this stage" for a selected stage ([A03 §2](./A03-stage-accordion.md)), or the last full run for `Output`. Selecting does not run anything: a stage never run shows `Run up to this stage ⇧⌘↵` as its action.
- Its header matches the Documents canvas: the `Table | Tree | JSON` switch at the left ([W06 §8.1](./W06-result-views.md)), and at the right one **`Export results ▾`**: `Copy`, `Download…`, `Save to collection…`, `Create view…` ([A05 §7](./A05-output-panel.md)). There is no second "Save as".

### 9.5 Empty pipeline

- Under the source chip: `Add a first stage`, with chips `$match` `$group` `$sort` `$project` `$lookup` `$unwind` and `All stages…` (the full picker of A03 §4). A chip adds that stage with its default body.
- The preview column shows a muted line, `Add a stage to run`, and Run's tooltip says the same.

### 9.6 Acceptance criteria

- No separate outline panel is drawn; the stages column lists every stage in order with its number and operator.
- A collapsed stage card is one 32px row.
- Selecting a stage that has been run up to shows that output in the preview; selecting `Output` shows the full run; selecting never starts a run.
- The pipeline bar has one Save control with Save and Save as…; the preview header has one `Export results ▾` with four items; the words "Save as" appear in one menu only.
- An empty pipeline shows the six starter chips and `All stages…`; a chip adds its stage.
- With Run unavailable, both its tooltip and the preview column state the reason.
- Below 1100px the columns stack.
- Run is the only filled button in the view.

### 9.7 Test cases

- **Component** (`aggregation-tab`): the three regions; the Save menu; stage selection driving the preview without a run; the empty state's chips; the stated reason for a disabled Run; the stacked layout under 1100px.
- **Component** (`output-panel`): `Export results ▾` and its four actions, each calling what Copy, Download, Save as… and Save as view… called.
- **E2E** (`a01-aggregation-run`): build a pipeline from a starter chip, run it, run up to the first stage and read its preview, export the result.
