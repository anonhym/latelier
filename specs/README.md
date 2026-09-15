# MongoLab — Iteration 1 Specifications

This directory contains the specifications for MongoLab iteration 1. Each spec describes a single testable component (UI component, service, data model, or cross-cutting concern) in enough detail to implement and test independently.

> **Iteration 1 status: SHIPPED.** F01–F06, C01–C08, W01–W10, A01–A06, and X01–X06 are all implemented and tested. Indexes/Users tabs shipped as intentional stubs (per C08) at the time; both were later built out with real CRUD in post-iteration-1 specs C09/C10. Open follow-ups live in GitHub Issues. Migrations 004 (`auth_mech 'default'`), 005 (reference rules backing X05), and 006 (workspace tab pinning) were added during the phase but not pre-planned.

## Scope of iteration 1

- **In-scope**: SQLite persistence, secrets vault, IPC bridge, Mongo client pool, connection CRUD, NewConnection page, ConnectionManager, Workspace with real data + tabs + Tree/JSON/Table views + builder + query bar bidirectional sync + pagination + document write ops + saved/recent queries, Aggregation with real pipeline runs + stage previews + save + explain, theme/window state persistence.
- **Deferred**: SSH tunneling (spec stub only), full CmdK palette, multi-window support, import from Compass, replica-set topology views, change streams, transactions UI. (Indexes tab and Users tab, listed as deferred at the time, later shipped — see C09/C10.)

## Architectural ground rules

1. **All logic lives in the main process.** The renderer is a dumb UI — it must never import `mongodb`, `better-sqlite3`, `ssh2`, `fs`, or any Node-only API. All I/O, all data persistence, all Mongo calls, all secret decryption happen in main and are exposed to the renderer through a typed IPC bridge.
2. **Persistence**: SQLite via `better-sqlite3` at `app.getPath('userData')/mongolab.db`. Migrations on startup. Schema versioned.
3. **Secrets**: Electron `safeStorage` encrypts per-field strings; ciphertext stored as blobs in `connection_secrets`; plaintext never crosses IPC back to the renderer.
4. **IPC**: one `window.atelier` namespace exposed via `contextBridge` (renamed from `window.mongolab`, see [X09](./X09-namespace-rename.md)). Every channel is `invoke`-style (promise). Every payload is runtime-validated in main. Errors return a structured envelope, not raw throws.
5. **Process model**: single window with a tab system. Connection creation is a modal-like route; ConnectionManager and Workspace are top-level routes; Aggregation is a tab type *inside* Workspace.
6. **BSON across the wire**: Extended JSON v2 (EJSON). Serialized in main, parsed in renderer when rendering; renderer-side edits are round-tripped through EJSON back to main.
7. **Testing**: Vitest for unit/integration/component tests; Playwright + `@playwright/test` with the Electron driver for end-to-end. Each spec declares its test cases.

## Spec index

### Foundation (F) — infrastructure and cross-layer

| ID  | Title | Layer |
| --- | ----- | ----- |
| [F01](./F01-architecture.md) | Architecture & conventions | meta |
| [F02](./F02-sqlite-persistence.md) | SQLite persistence & migrations | main |
| [F03](./F03-secrets-vault.md) | Secrets vault (safeStorage) | main |
| [F04](./F04-ipc-bridge.md) | IPC bridge & error envelope | main + preload |
| [F05](./F05-mongo-client-pool.md) | Mongo client pool & lifecycle | main |
| [F06](./F06-app-lifecycle.md) | App startup & shutdown | main |

### Connections (C) — phase 1 + phase 2

| ID  | Title | Layer |
| --- | ----- | ----- |
| [C01](./C01-connection-model.md) | Connection model, URI parser, validation | main |
| [C02](./C02-connection-repository.md) | Connection repository (CRUD) | main |
| [C03](./C03-new-connection-page.md) | NewConnection page UI | renderer |
| [C04](./C04-test-connection.md) | Test connection action | main + renderer |
| [C05](./C05-connection-manager-shell.md) | ConnectionManager deep detail screen (`/connections/:id`) | renderer |
| [C06](./C06-overview-tab.md) | Overview tab (real stats) | main + renderer |
| [C07](./C07-collections-tab.md) | Collections tab (real listing) | main + renderer |
| [C08](./C08-edit-delete-stubs.md) | Edit, delete, stub tabs, CmdK stub | renderer |
| [C09](./C09-indexes-tab.md) | Indexes tab (real listing + create / drop) — *post-iteration-1* | main + renderer |
| [C10](./C10-users-tab.md) | Users tab (real listing + create / update / drop) — *post-iteration-1* | main + renderer |
| [C11](./C11-troubleshooting.md) | Connection troubleshooting drawer + inline explainers + docs — *post-iteration-1* | renderer + docs |
| [C12](./C12-auto-remediation.md) | Auto-remediation buttons in the troubleshooting drawer — *post-iteration-1* | renderer |

### Workspace (W)

| ID  | Title | Layer |
| --- | ----- | ----- |
| [W01](./W01-workspace-shell.md) | Workspace shell + tab management | renderer |
| [W02](./W02-db-collection-navigator.md) | DB/collection navigator sidebar | main + renderer |
| [W03](./W03-query-runner.md) | Query runner service | main |
| [W04](./W04-query-builder-pane.md) | Query builder pane (state + compile) | renderer |
| [W05](./W05-query-bar.md) | Query bar + bidirectional MQL sync | renderer |
| [W06](./W06-result-views.md) | Result views (Tree / JSON / Table) | renderer |
| [W07](./W07-pagination.md) | Pagination control | renderer |
| [W08](./W08-document-write-ops.md) | Document write ops (insert/edit/delete) | main + renderer |
| [W09](./W09-saved-queries.md) | Saved queries (repo + UI) | main + renderer |
| [W10](./W10-recent-preview.md) | Recent queries + preview fields | main + renderer |
| [W11](./W11-mongo-shell.md) | Mongo shell pane (in-process REPL) — *post-iteration-1* | main + renderer |
| [W12](./W12-script-editor.md) | Script editor tab — *post-iteration-1* | main + renderer |
| [W13](./W13-filter-tree-editor.md) | Filter tree editor (supersedes the W04 condition model + W05 sync machine) — *post-iteration-1* | renderer |
| [W14](./W14-query-bar-advanced-row.md) | Query bar advanced row: correctness, affordance, projection — *post-iteration-1* | renderer |
| [W15](./W15-query-composition.md) | Query composition audit — projection / sort / limit / skip and the drawer's role after W13 — *post-iteration-1* | renderer |
| [W16](./W16-structure-view.md) | Structure view — indexes + schema in the collection tab, plan badge, create-this-index (amends C09; ADR 0003) — *post-iteration-1* | renderer + main |
| [W17](./W17-edit-drawer-type-warning.md) | A field-type warning in the Update drawer — *post-iteration-1* | renderer |

### Aggregation (A)

| ID  | Title | Layer |
| --- | ----- | ----- |
| [A01](./A01-aggregation-shell.md) | Aggregation shell + tab routing | renderer |
| [A02](./A02-pipeline-outline.md) | Pipeline outline + model | renderer |
| [A03](./A03-stage-accordion.md) | Stage accordion + add-stage picker | renderer |
| [A04](./A04-aggregation-runner.md) | Aggregation runner service | main |
| [A05](./A05-output-panel.md) | Pipeline output panel | renderer |
| [A06](./A06-save-explain.md) | Save pipeline / save as collection / explain | main + renderer |

### Cross-cutting (X)

| ID  | Title | Layer |
| --- | ----- | ----- |
| [X01](./X01-theme-window-state.md) | Theme & window state persistence | main + renderer |
| [X02](./X02-field-suggestions.md) | Field & value suggestions (autocomplete) | renderer + main |
| [X03](./X03-mql-operators.md) | MQL operator autocomplete | renderer |
| [X04](./X04-operator-docs.md) | MQL operator inline docs | renderer |
| [X05](./X05-document-references.md) | Document references (cross-collection chips/drawer) | main + renderer |
| [X06](./X06-feature-hints.md) | Contextual feature hints | renderer |
| [X07](./X07-command-palette.md) | Command palette (⌘K) — *post-iteration-1* | renderer |
| [X08](./X08-brand-identity.md) | Brand identity (L'Atelier visual rollout) — *post-iteration-1* | renderer |
| [X09](./X09-namespace-rename.md) | Namespace rename (MongoLab → L'Atelier) — *post-iteration-1* | main + preload + renderer |
| [X10](./X10-renderer-retheme.md) | Renderer re-theme — *post-iteration-1* | renderer |
| [X11](./X11-workspace-composition.md) | Workspace composition refactor — *post-iteration-1* | renderer |
| [X12](./X12-mantine-migration.md) | Mantine migration — *post-iteration-1* | renderer |
| [X13](./X13-operation-audit-log.md) | Operation audit log & undo — *post-iteration-1* | main + renderer |
| [X14](./X14-shell-syntax-input.md) | Shell Syntax input on the read-query surfaces — *post-iteration-1* | renderer |
| [X15](./X15-dialog-consolidation.md) | Dialog consolidation onto Mantine + unsaved-changes guards — *post-iteration-1* | renderer |
| [X16](./X16-multi-connection.md) | Multi-connection Data View (retires the single-active-connection policy assumed by W02 §1b) — *post-iteration-1* | renderer + pool |


## Implementation order

The specs are numbered in recommended build order. Foundation first (F01→F06), then connections (C01→C08), then workspace (W01→W10), then aggregation (A01→A06), with X01 touched throughout.

## Spec template

Each spec follows this structure:

1. **Purpose** — what this component does in one paragraph.
2. **Scope** — explicit in-scope / out-of-scope bullets.
3. **Dependencies** — other specs this one depends on.
4. **Types** — TypeScript interfaces / data model.
5. **IPC contract** (if applicable) — channel names, payloads, errors.
6. **Behavior** — step-by-step interactions, states, edge cases.
7. **UI** (if applicable) — layout diagram, components, keyboard shortcuts, accessibility notes.
8. **Persistence** (if applicable) — SQL schema touches, file writes.
9. **Error handling** — failure modes and UX response.
10. **Acceptance criteria** — checklist of verifiable outcomes.
11. **Test cases** — unit / integration / component / E2E tests.
