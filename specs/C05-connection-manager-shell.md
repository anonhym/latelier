# C05 — ConnectionManager deep detail screen

> **Status: Accepted.** §1–§10 shipped; ADR 0001 retired the list sidebar and `/connections` redirects to the workspace. §11, which moves this screen into the Data View as a server tab, is agreed and not built yet.

## Purpose

The deep, bare detail screen for one Connection (path `/connections/:id`). Houses the title bar
with a back affordance to the Data View, and the detail area (Overview / Collections / Indexes /
Users). Owns delete confirmation for the Connection it's showing.

> Superseded (ADR [0001](../docs/adr/0001-data-view-home-connection-switcher.md)): the
> list-sidebar this page originally shipped with is retired. The Data View (`/workspace`) is the
> app's home now; the Switcher popover is the one canonical list of saved Connections
> (see [X11](./X11-workspace-composition.md) / `ConnectionSwitcher.tsx`). This screen is reached
> only via the Switcher's "Manage connection…" action — deep-link only, never landed on.

## Scope

- **In**: Shell layout, title bar with a back-to-Data-View affordance, resolving the Connection
  from `:id`, a not-found state for an id that no longer resolves, top-level delete confirmation
  (delegates actual work to C08's successor, `ConnectionDeleteDialog`).
- **Out**: Detail-tab content (Overview C06, Collections C07, Indexes C09 — amended by W16 Tier 1,
  Users C10), the Connection list (retired — see ADR 0001; the Switcher is the list now), the
  Connection creation / edit form (C03), CmdK palette (X07).

## Dependencies

- C01, C02 (`conn:list`, `conn:delete`, `conn:touchUsed`), F05 (`mongo:status` events for the live
  status badge).

## 1. Routes

- `/connections/:id` — this page. No selection state beyond the route param; there is no sibling
  list to fall back through.
- `/connections` (bare, no id) — retired; redirects to `/workspace` (App.tsx).
- `/connections/new` — NewConnection create mode (C03). Returns to `/workspace` on save/cancel.
- `/connections/:id/edit` — NewConnection edit mode (C03). Returns to `/connections/:id` on
  save/cancel.

## 2. Component tree

```
ConnectionManager
 ├── TitleBar (back-to-Data-View affordance + CmdK opener + theme toggle)
 └── DetailPanel (Overview / Collections / Indexes / Users, keyed by :id)
```

## 3. Selection

Selection comes strictly from `useParams<{ id }>()` — matched against the live `conn:list`
snapshot (via `useConnections()`, so the status badge stays live). There is no "select the first
Connection" fallback: an id that doesn't resolve (deleted elsewhere, stale bookmark) renders the
not-found state below, not an empty-list state.

## 4. Not-found state

If `:id` doesn't match any Connection in the live list: "This connection no longer exists." with a
**Back to Data View** button (`navigate('/workspace')`).

## 5. Title bar

- Back affordance: `← Data View` — `navigate('/workspace')`.
- Breadcrumb: the Connection's name (or "Connection" while unresolved).
- CmdK opener, theme toggle (unchanged from the retired shell).

## 6. Detail header actions

Rendered by `DetailPanel`, next to the Connection's name/status:

- **Edit** → `/connections/:id/edit`.
- **Delete** → opens `ConnectionDeleteDialog`; confirming calls `api.conn.delete(id)` and always
  navigates to `/workspace` (there is no sibling row to fall back to — see §7).
- **Disconnect** (only when connected) → `api.mongo.disconnect(id)`.
- **Open workspace** (primary) → `/workspace` with `state.openForConnection`.

## 7. Delete flow

- Confirm dialog (shared `ConnectionDeleteDialog`, also used by the Switcher):
  > Delete "**{name}**"?
  > This removes the saved connection and all its saved queries and history. Mongo data on the
  > server is not touched.
  > [Cancel] [Delete]
- Confirm calls `api.conn.delete(id)`:
  - On success: navigate to `/workspace` (replace).
  - On `NOT_FOUND`: navigate to `/workspace` (replace) — already gone.
  - On `DB_ERROR`: banner; dialog closes, screen stays put.

## 8. Accessibility

- Status badge and detail content carry the same accessibility contract as before (C06/C07/C09/C10
  are unchanged by this rewrite).
- The back affordance and delete/edit buttons are plain `<button>`s reachable by keyboard.

## 9. Acceptance criteria

- `/connections/:id` renders the Connection named by the route param, with its Overview /
  Collections / Indexes / Users tabs intact.
- An id that doesn't resolve shows the not-found state, not a blank screen or a crash.
- The back affordance navigates to `/workspace`.
- Deleting the shown Connection navigates to `/workspace`.
- `/connections` (bare) and `/` both redirect to `/workspace`.
- A Mongo status change broadcast by main updates the header's status badge within 500ms.

## 10. Test cases

### Component (`tests/component/connection-detail.spec.tsx`)
- **renders-by-route-id**: mock `api.conn.list` → the connection named by `:id` renders.
- **not-found**: an id absent from the list → not-found copy + working back button.
- **back-affordance**: TitleBar's back button navigates to `/workspace`.
- **delete-navigates-home**: confirming delete calls `api.conn.delete` and lands on `/workspace`.

### E2E
- Reached via the Switcher's "Manage connection…" (`⌘↵` or the row's Manage icon) — see
  `conn-switcher-keyboard.e2e.ts` / the Switcher's own e2e coverage for that path.

## 11. Amendment — the server screen becomes a tab

> **Accepted, not built.** It supersedes §1 (routes), §5 (title bar) and the back link, and moves §6's header actions. Recorded in the 2026-11-13 amendment to [ADR 0001](../docs/adr/0001-data-view-home-connection-switcher.md).

Monitoring and user management lived on a separate full-page route reached only through a Switcher icon or the palette, so they were in effect undiscoverable, and visiting them meant leaving the shell that says where you are.

### 11.1 The server tab

- A workspace tab of kind **`server`** ([W01 §14.12](./W01-workspace-shell.md)), one per Connection, labelled `Server`, with its Connection's stripe. The breadcrumb reads `● {connection} › Server`.
- Its content is this screen's: **Overview, Monitor, Collections, Users, Roles**, the same components, as a section switch inside the tab. The section in view is tab state and survives a relaunch.
- §6's header actions (Connect / Disconnect, Edit, Delete) sit in the Overview section's header.
- A Dormant or disconnected Connection's server tab shows Overview with Connect; the other sections say they need a connection, as today.
- Opening the server tab of a Connection that already has one focuses it.
- Disconnecting or deleting the Connection closes its server tab with its other tabs ([X16 §4.6](./X16-multi-connection.md)).

### 11.2 Entry points

- The navigator's Connection root: a `Server` control on hover and focus, and `Server overview` in its menu ([W02 §16](./W02-db-collection-navigator.md)).
- The Switcher's and the Connections table's row `⋯`: `Open server overview` ([X16 §13.3](./X16-multi-connection.md)); `⌘↵` on a Switcher row.
- The palette's Connection object: `Open server overview`, replacing `Manage`.

### 11.3 Routes

- `/connections/:id` redirects to `/workspace` and opens that Connection's server tab. An unknown id lands on the workspace with §4's not-found message as a toast.
- `/connections/new` and `/connections/:id/edit` are unchanged.

### 11.4 Persistence and IPC

- A migration adds `server` to the `workspace_tabs.kind` check. A server tab stores empty `db_name` and `collection`, as a script tab does, and `{ section }` as its state.
- One new channel, `tabs:openServer({ connectionId })`, returning the tab; it reuses an existing server tab for that Connection. It carries no secret. It is wired through the whole contract: the shared types, the preload binding, the handler's schema and registration, and an integration test.

### 11.5 Acceptance criteria

- `Server` on a navigator root opens a tab labelled Server showing Overview, with Monitor, Collections, Users and Roles one click away.
- Opening it twice leaves one server tab for that Connection.
- The chosen section survives a tab switch and a relaunch.
- Connect, Disconnect, Edit and Delete are reachable from Overview.
- `/connections/:id` opens the workspace on that Connection's server tab; no full-page connection screen remains.
- Disconnecting the Connection closes its server tab.

### 11.6 Test cases

- **Integration**: the migration keeps existing tabs and accepts a `server` row; `tabs:openServer` creates one tab and returns the same tab on a second call; closing a Connection's tabs includes it.
- **Component** (`detail-panel`, `connection-detail`): the sections inside a tab; the section restored from state; header actions; the Dormant state.
- **Component**: each entry point opens or focuses the tab; the route redirect.
- **E2E** (`conn-detail-overview`, `conn-detail-roles`): reach Overview and Roles through the navigator's Server control.
