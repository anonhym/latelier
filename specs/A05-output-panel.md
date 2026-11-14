# A05 — Pipeline output panel

> **Status: Implemented.** §1–§6 shipped. §7 is built: the panel is the preview column of [A01 §9](./A01-aggregation-shell.md), and its Copy, Save as…, Save as view… and Download are one `Export results ▾` menu, which acts on the full pipeline output whatever stage is selected.

## Purpose

The bottom panel of the aggregation tab. Shows the pipeline's final output in Tree / JSON / Table form, with a resizable height. Reuses W06's view components where possible, with agg-specific affordances (copy-all, save-as-collection, download JSON).

## Scope

- **In**: Output panel shell, drag-to-resize, view toggle, empty/loading/error states, Copy, Save as collection (which triggers A06), download JSON.
- **Out**: Explain drawer (A06), stage preview (A03).

## Dependencies

- W06 (views), A01 (state), A04 (result).

## 1. Layout

```
┌─ drag handle (6px) ─────────────────────────────────────────────────┐
├─ header ────────────────────────────────────────────────────────────┤
│ Pipeline output  · 5 docs · 128ms       [Tree/JSON/Table]  [Copy]   │
│                                                         [Save as…] [⇩]│
├─ body ──────────────────────────────────────────────────────────────┤
│ docs                                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. Behavior

### Drag handle
- Changes `state.outputHeight` between 120 px and 70% of window height. Persisted via tab state (W01).
- Double-click resets to default 260 px.

### View toggle
- Same control as W06. State stored in `state.outputView`.

### Copy
- Copies pretty-printed EJSON array of all rows (not EJSON relaxed) to clipboard.
- Copies the output, not the pipeline: the pipeline itself is copied from the title bar's Copy menu (A01 §4).

### Save as collection
- Opens A06 "Save as collection" modal — fills in `$out` stage and re-runs if allowed. See A06.

### Download JSON (⇩)
- Opens `dialog.showSaveDialog` (via `app:saveFile` IPC returning a path or null). On success, writes the full EJSON array to disk.

## 3. Views

- **Tree / JSON / Table** delegate to W06 components with the aggregation's `rows` instead of the workspace's docs.
- Table view treats nested `_id` objects (common in aggregation output) by flattening top-level keys, showing `_id.account`, `_id.month`, etc.

## 4. States

The empty, not-run and failed states are the W06 pane states (`PaneState`), each with a next action.

- **No run yet**: "Run the pipeline to see output", with a Run pipeline button.
- **Running**: subtle overlay with spinner; keeps previous output visible.
- **Empty result**: "The pipeline returned no documents", pointing at the stage previews, with Run again.
- **Error**: "The pipeline failed", with `code: message` and the server's details (when present) in one scrollable block, and Run again. The run buttons are disabled while a run is in flight or a stage body does not parse, like the toolbar's Run.

## 5. Acceptance criteria

- Drag handle resizes the panel within the documented bounds; double-click resets.
- Height persists across tab switches and relaunches.
- View mode switches synchronously (no re-run).
- Copy produces EJSON canonical output.
- Download writes a valid file to the chosen path.
- Save as collection opens the A06 modal with target collection pre-filled.
- Error state shows code, message and details, and offers Run again.

## 6. Test cases

### Component
- **resize.spec.tsx**: drag pushes height; persists via `api.tabs.update`.
- **view-switch.spec.tsx**: toggling Tree/JSON/Table doesn't call any IPC.
- **copy.spec.tsx**: click Copy → clipboard receives expected EJSON.
- **download.spec.tsx**: click ⇩ → mocked `api.app.saveFile` called; file write channel receives payload.
- **empty.spec.tsx**: `rows=[]` → empty placeholder.
- **error.spec.tsx**: mock error → pane state with code, message and details; Run again calls the run.

## 7. Amendment — the preview column and one Export menu

> The design is [A01 §9.4](./A01-aggregation-shell.md).

- The panel is the **preview column**, beside the stages rather than under them; stacked under them below 1100px or by its toggle. In the stacked arrangement §2's drag handle and `outputHeight` apply as before; side by side, the divider between the columns is what resizes.
- It shows the selected stage's output or the full run's (A01 §9.4). §4's states (not run, running, empty, error) apply to whichever is shown.
- §2's four actions become one menu, **`Export results ▾`**: `Copy` (the same Canonical EJSON array as §2), `Download…`, `Save to collection…` (was "Save as…"), `Create view…` (was "Save as view…"). The pipeline has its own Save; calling these "Save as" too gave one view two "Save as" that did different things.
- The view switch is the Documents canvas's, in the order Table, Tree, JSON.

### Acceptance criteria

- The preview header has the view switch and one `Export results ▾`; no control in it is named "Save as".
- Each of the four items does what its predecessor did, with the same disabled rules (nothing to copy with no rows; nothing while running).
- Side by side, dragging the divider resizes the columns; stacked, the height handle works as in §2.

### Test cases

- **Component** (`output-panel`, `output-panel-readable-ejson`, `save-as-view-navigator-refresh`): the menu's items and disabled states; Copy's text unchanged; Create view still refreshing the navigator.
