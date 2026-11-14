# W01 — Workspace shell + tab management

> **Status: Accepted.** §1–§13 shipped, with Aggregation as a sub-view of the collection tab (§5), not the separate tab kind §2 lists. §14, the One Spine shell, is agreed and not built yet; where §14 names a part of §7, §10 or §11, §14 is what ships.

## Purpose

The workspace is the tabbed IDE-like page. This spec defines the outer shell (title bar, tab strip, three-column layout placeholder) and, crucially, **the tab system**: what a tab is, how tabs are created/moved/closed, how state is persisted so relaunching the app restores the user's session.

## Scope

- **In**: Tab type and state shape; tab strip UI; create/close/reorder/switch; per-tab state isolation; session persistence via `workspace_tabs` (F02) and IPC; title bar with breadcrumb; "+" new-tab menu; empty state.
- **Out**: Inner content of a collection tab (W02–W07), aggregation tab (A01–A06), document write ops (W08), saved/recent/preview (W09–W10).

## Dependencies

- F02 (`workspace_tabs` table), F04, C02, C07.

## 1. Route

- `/workspace` — current active window on whatever the last-active tab was.
- No `:id` param. The active tab is a piece of persistent UI state, not URL state — the URL is just "I'm in workspace".
- Workspace is only meaningful with at least one saved connection. If none exist, redirect to `/connections`.

## 2. Tab type

```ts
// shared/types.ts
export type WorkspaceTabKind = 'collection' | 'aggregation';

export interface WorkspaceTabBase {
  id: string;                    // UUID
  kind: WorkspaceTabKind;
  connectionId: string;
  dbName: string;
  collection: string;
  position: number;
  openedAt: string;
}

export interface CollectionTabState {
  view: 'Tree' | 'JSON' | 'Table';
  builder: {
    conditions: Cond[];          // see W04
    logic: 'AND' | 'OR';
    projection: string[];
    sort: string;                // raw MQL
    limit: string;               // raw MQL
  };
  queryRaw?: string;             // overrides builder if user hand-edited
  queryDirty: boolean;
  page: number;
  pageSize: number;
  activeBuilderTab: 'Builder' | 'Saved' | 'Recent';
}

export interface AggregationTabState {
  name?: string;                 // saved name, if any
  savedId?: string;
  stages: Stage[];               // see A02
  activeStageId: number | null;
  outputHeight: number;          // px, user-resized
  outputView: 'Tree' | 'JSON' | 'Table';
}

export type CollectionTab = WorkspaceTabBase & { kind: 'collection'; state: CollectionTabState };
export type AggregationTab = WorkspaceTabBase & { kind: 'aggregation'; state: AggregationTabState };
export type WorkspaceTab   = CollectionTab | AggregationTab;
```

## 3. State (renderer)

```ts
const [tabs, setTabs] = useState<WorkspaceTab[]>([]);
const [activeId, setActiveId] = useState<string | null>(null);
const active = tabs.find(t => t.id === activeId) ?? null;
```

Tab state lives in the renderer for responsiveness but is mirrored to main on every mutation via `tabs:update`.

## 4. IPC contract

| Channel              | Input                                                               | Output                | Notes |
| -------------------- | ------------------------------------------------------------------- | --------------------- | ----- |
| `tabs:list`          | —                                                                   | `WorkspaceTab[]`      | ordered by position |
| `tabs:openCollection`| `{connectionId, dbName, collection, reuseExisting?: boolean}`       | `WorkspaceTab`        | |
| `tabs:openAggregation`| `{connectionId, dbName, collection, savedId?, name?}`              | `WorkspaceTab`        | creates a new agg tab |
| `tabs:openDefault`   | `{connectionId}`                                                    | `WorkspaceTab`        | C08 used this |
| `tabs:update`        | `{id, patch: Partial<TabState>}`                                    | `WorkspaceTab`        | patch writes to `state_json` |
| `tabs:close`         | `{id}`                                                              | `{ newActiveId: string\|null }` | |
| `tabs:setActive`     | `{id}`                                                              | `void`                | |
| `tabs:reorder`       | `{orderedIds: string[]}`                                            | `void`                | |

## 5. Open semantics

### `tabs:openCollection`
- `reuseExisting` default: `true`. If a tab already matches `(connectionId, dbName, collection)`, activate it instead of creating a duplicate.
- If false, always create a new tab (used by "Open in new tab" actions).
- New tab `position = max(position) + 1`. Becomes active.
- Initial `state` is the default `CollectionTabState` (view=Tree, empty builder, pageSize=50, page=1).

### `tabs:openAggregation`
- Reuses the collection tab already open on `(connectionId, dbName, collection)`, switching it to the Aggregation sub-view; otherwise creates a new collection tab parked there. A `savedId` or `name` reseeds that tab's aggregation state; without either, its aggregation state is kept.
- Initial `state.stages` is empty, or hydrated from a saved pipeline if `savedId` present (W09). Main does the hydration, since the call carries no stages. The saved query must be a pipeline whose stored stages are readable and which belongs to the same connection, database and collection as the tab, because the tab's Save writes back to it. An unknown `savedId` answers `NOT_FOUND`; any other mismatch answers `VALIDATION`. Neither opens or changes a tab.

### `tabs:list`
- A saved-pipeline tab that is clean (not `dirty`) yet has no stages gets the stored stages back. Only a tab persisted before the hydration above existed can be in that state, since every stage edit marks the tab `dirty`. A saved query that is gone or unreadable leaves the tab as it is.

### `tabs:openDefault`
- Pick first non-system DB; pick its first collection; call `tabs:openCollection` semantics.
- If nothing exists, still create a tab but flag it in renderer as "nothing here yet" with instructions to create a collection outside the app.

## 6. Close semantics

- `tabs:close` removes the tab.
- If closing the active tab: new active is the adjacent left tab, else the right; if none, `activeId = null` (empty state).
- The UX **always** allows closing the last tab (unlike the current mock which prevents it). Empty state renders a placeholder.
- Confirmation dialog only if the tab has unsaved agg-pipeline changes or a dirty builder.

## 7. Tab strip UI

```
┌───────────────────────────────────────────────────────────────────────┐
│ journalEntry │ order ×  │ Σ monthlyByAccount ×                   │
└───────────────────────────────────────────────────────────────────────┘
```

- **Icons**: none for collection tabs, Σ for aggregation tabs (use SVG from `icons.tsx`).
- **Close (×)** on hover; always visible on active tab.
- **Drag to reorder** — HTML5 drag events, snap into new position on drop. Debounced `tabs:reorder` call.
- **Overflow**: horizontal scroll with subtle gradient fade. Never wrap.
- **No "+" button.** A new collection tab opens from the navigator, ⌘T, the command palette, or the empty state; each opens the tiny modal (see §8).
- **Tab Groups**: one per Connection, with a header filled in the Connection's colour (brighter when it holds the Focused Tab). Clicking the header collapses or expands the group. Each tab carries a bottom border in that colour, dim until it is the Focused Tab.
- **Former "+▾" new-tab menu** (superseded):
  - "New aggregation on current collection" → opens an agg tab with the same coll.
  - "New script" (stub) → toast "coming soon".
  - Separator, then recent connections → clicking one runs `tabs:openDefault(connectionId)`.

### Tab context menu

Right-click on a tab, or Shift+F10 / the ContextMenu key on a focused tab, opens a menu with:

- **Pin tab / Unpin tab** and **Close tab**, as before.
- **Close others** closes every other tab in the strip.
- **Close to the right** closes every tab to the right of this one.
- **Reveal in sidebar** shows the tab's collection in the navigator. Collection tabs only: a script tab has no navigator row, so the item is absent.

Both bulk closes follow the same rules:

- **Order.** "To the right" means the order on screen. Tabs render grouped by connection, so this can differ from the stored `position` order whenever the stored tabs of two connections interleave.
- **Collapsed groups.** A collapsed group's tabs are not on screen, so neither action closes them.
- **Pinned tabs** are never closed by a bulk action, and neither is the tab the menu was opened on.
- **Disabled when empty.** Each item is disabled when it would close nothing.
- **Unsaved pipelines.** If any tab to be closed has an unsaved pipeline, one confirmation names how many. Cancel closes nothing. Confirm closes them all. If the active tab is among them, the tab the menu was opened on is activated first, so focus never lands on a tab that is about to close.

Reveal in sidebar:

1. Activates the tab, waking a dormant connection the same way a click does.
2. Opens the sidebar if it is collapsed.
3. Expands the tab's connection root and its database, clears the navigator's name filter so it cannot hide the row, and re-lists the database's collections (sharing a load already in flight).
4. Moves the navigator's focus (its `aria-activedescendant`) to the collection row once that row is rendered, which scrolls it into view. The request is then spent: reopening the sidebar later focuses the active tab's row, not this one.
5. If that listing settles without the collection (it was dropped, or the listing failed), the request is dropped instead. It never fires later, when the collection reappears and the user has moved on.

Real DOM focus stays where the menu returns it.

### Collection view strip

Above a collection tab, a strip switches between Documents, Aggregation and Structure. It is a tablist (`aria-label="Collection view"`) built on Mantine `Tabs`, in the same root as the three view panels, so each tab's `aria-controls` points at a real `tabpanel` that names the tab back with `aria-labelledby`.

- One tab stop: only the selected tab is reachable with Tab.
- Left and Right move focus and select that view; Home and End move focus to the first and last tab, and Enter or Space selects it.
- Only the selected view's panel is mounted, so an unselected view does no work.

## 8. New-collection-tab modal

- Small centered modal:
  - Select: Connection (current one pre-selected).
  - Select: Database (populated via `meta:listDatabases`).
  - Select: Collection (populated via `meta:listCollections` on db change).
- Confirm → `tabs:openCollection({...})`.
- Cancel closes.

## 9. Session restore

On mount of `/workspace`:
1. `const tabs = await api.tabs.list()`.
2. If tabs exist → activate the one with `is_active = 1` (else the last one).
3. Else if there's at least one saved connection → render empty state with an "Open a collection…" button that opens the new-tab modal.
4. Else redirect to `/connections`.

Settings carries a "Reopen tabs on launch" switch, stored under `ui.workspace.restoreTabs`. An unset value means on, so the behaviour above is the default. When the value is `false`, the main process closes every tab (pinned ones included) once at boot, right after the tab service is built, so the workspace opens empty. The check lives in main rather than in the `/workspace` mount because that page remounts on route changes and would wipe tabs mid-session. Nothing asks at quit with the setting off, so a tab holding unsaved pipeline changes is lost at the next launch along with the rest; the switch's description in Settings says so.

Every renderer state change in a tab triggers `api.tabs.update(id, patchOfState)` with a **debounced** (250ms) writer. This keeps session restoration on par with the last typed-but-unsaved state without thrashing SQLite.

## 10. Breadcrumb in title bar

Format: `{connection.name} / {dbName} / {collection}  [· kind]` where kind is rendered if agg. The breadcrumb left-side has a back button → `/connections`.

## 11. Keyboard

| Shortcut            | Action |
| ------------------- | ------ |
| `⌘T`                | Open new-collection-tab modal |
| `⌘⇧T`               | Open aggregation tab on current coll |
| `⌘W`                | Close current tab |
| `⌘⇧W`               | Close all other tabs |
| `⌘1`…`⌘9`           | Switch to Nth tab |
| `⌘⌥→` / `⌘⌥←`       | Next / previous tab |
| `⌘K`                | CmdK overlay (C08 stub) |

## 12. Acceptance criteria

- Relaunching the app restores previously open tabs, positions, active tab, and the builder state of the active collection tab (view mode, builder conditions, sort, limit).
- With "Reopen tabs on launch" off, a relaunch starts with no tabs, pinned ones included; switching it back on restores the default behaviour.
- Closing the last tab leaves the workspace on an empty state; reopening via "+" restores functionality.
- Reordering tabs persists and survives relaunch.
- Switching tabs never calls `api.meta.*` or `api.query.*` — those run on tab activation in their own spec.
- Opening the same collection twice (with default `reuseExisting`) activates the existing tab.
- Aggregation tab opens without a default pipeline; builder starts empty.

## 13. Test cases

### Integration (main)
- **tabs-crud.spec.ts**: openCollection → list returns one row; openCollection same coll again → still one row (reuseExisting); openCollection reuseExisting:false → two rows with distinct ids.
- **active-follows-close.spec.ts**: open three, activate middle, close it → newly active = left neighbor.
- **reorder.spec.ts**: reorder persists; `tabs:list` returns the new order.
- **update-debounce.spec.ts**: rapid updates collapse (observer receives at most one write per 250ms window).
- **restore-tabs-boot.spec.ts**: with `ui.workspace.restoreTabs` false, boot closes every tab, pinned ones included; true or unset keeps them.

### Component
- **tab-strip-render.spec.tsx**: renders N tabs with correct icons and active styling.
- **tab-drag.spec.tsx**: simulate drag → `api.tabs.reorder` called with the new order.
- **new-tab-menu.spec.tsx**: click "+" → menu items visible; "New aggregation on current collection" invokes `api.tabs.openAggregation`.
- **keyboard-switch.spec.tsx**: `⌘2` activates the second tab.
- **collection-subtabs.spec.tsx**: the collection view strip is a tablist: arrow keys move focus and selection, Home and End move focus, only the selected tab is a tab stop, it points at a tabpanel that points back, and a click changes the view.
- **settings-modal-restore-tabs.spec.tsx**: the "Reopen tabs on launch" switch reads on when unset and off when stored false, saves the new value, toasts and reverts a failed save, and its description says unsaved pipeline changes are lost with the tabs.
- **workspace-tab-groups.spec.tsx** (tab context menu): Close others and Close to the right close the tabs on screen in the strip's grouped order, keep pinned tabs and collapsed groups, hand focus to the menu's tab, ask once over unsaved pipelines, and keep closing the rest when one close fails, reporting it in one toast. Reveal in sidebar opens a collapsed sidebar, clears the navigator filter, waits for or re-lists the database, focuses the row, and drops a reveal whose database failed to list or whose collection is gone.

### E2E
- **restore.e2e.ts**: open two tabs → quit app → relaunch → both tabs present, active tab unchanged.
- **workspace-restore.e2e.ts**: tabs survive a quit and relaunch; with "Reopen tabs on launch" off, a relaunch starts with no tabs.

## 14. Amendment — One Spine shell

> **Accepted, not built.** It supersedes the parts of §7, §10 and §11 it names and leaves the rest standing.

### 14.1 Why, and the bands

A review of the shipped shell found the location stated in six places (Switcher pill, group chip, tab, navigator root, navigator row, sub-tab breadcrumb) while the database, the one thing that tells two `orders` tabs apart, showed once in small muted text. Six stacked bands took about 220px above the first document. The shell is rebuilt around one rule: one place per job, read top to bottom.

| Band | Height | Holds |
| --- | --- | --- |
| Location bar (title bar) | 40 | sidebar toggle, breadcrumb, search field, Console, Settings |
| Tab strip | 32 | tabs, `+ ▾` |
| View header | 36 | Documents / Aggregation / Schema & indexes, collection figures |
| Filter Bar row | 44 | [W05 §9](./W05-query-bar.md) |
| Canvas header | 28 | [W06 §8](./W06-result-views.md) |
| Status bar | 24 | connection, last run, pager |

The navigator's default width is 240px. Above the first row that is 180px instead of about 220, with no hint row.

### 14.2 Location bar

Supersedes §10.

- Left to right: the 70px traffic-light inset, a sidebar toggle (tooltip `Toggle sidebar ⌘B`; it replaces the edge notch), the breadcrumb, a drag spacer, the search field (§14.3), **Console** ([W11 §8](./W11-mongo-shell.md)), Settings. The theme toggle is gone from the bar ([X01 §8](./X01-theme-window-state.md)).
- **Breadcrumb**: `● {connection} › {database} › {collection}`, inside `<nav aria-label="Location">`. Three buttons; the dot carries the Connection's colour and status; the last segment is weight 600. It states the Focused Tab's identity, once.
  - The connection segment opens the Connection Switcher ([X16 §13](./X16-multi-connection.md)).
  - The database segment lists that Connection's databases; choosing one lists its collections in the same dropdown.
  - The collection segment lists the sibling collections with a filter box. Choosing one opens it under §5's reuse rule; ⌘-click or ⌘↵ opens a second tab.
- A script tab reads `● {connection} › {tab label}`; a server tab `● {connection} › Server`.
- **No tab, a Connection open**: `● {connection} › Choose a collection…`, naming the most recently connected Open Connection. The second segment opens the palette on its Collections scope. The bar never reads "Select a connection" while a Connection is open: the navigator already shows it connected, and the two must not disagree.
- **No Connection open, some saved**: one segment, `Select a connection`, opening the Switcher.
- **No saved Connection**: no breadcrumb; the welcome canvas ([C03 §13](./C03-new-connection-page.md)) fills the window.
- The `{db} / {collection}` text beside the view tabs is removed. Its figures move to the view header (§14.5).

### 14.3 Search field

A 320×26 button drawn as an input: a magnifier, the placeholder `Search collections and actions`, a `⌘K` key cap at the right. Its accessible name is the placeholder. A click or ⌘K opens the palette anchored under it ([X07 §14](./X07-command-palette.md)). It replaces the two-glyph `⌘ K` button, which advertised the app's fastest path with the least text, and keeps that button's `palette.discover` hint anchor.

### 14.4 Tab strip

Supersedes §7's "Tab Groups" and "No + button" bullets.

- A tab is: a 3px left stripe in its Connection's colour, a kind icon (collection; Σ while the tab shows Aggregation; script; server), the label, the dirty dot, the read-only marker, close.
- **Label.** The collection name. When two open tabs would show the same label, each shows `database.collection` instead. A tab's tooltip always gives `connection · database.collection`.
- **Script tabs** are titled `Script 1`, `Script 2`, … at open: one more than the highest number among the open scripts still carrying a default title. The title is stored like any other, so it stays put when another script closes, and the user can still rename it.
- **Group chip.** Shown only while tabs of two or more Connections are open ([X16 §13](./X16-multi-connection.md)). With one Connection the stripe carries the colour and the chip's 90px go back to the tabs.
- **`+ ▾`** at the end of the strip (accessible name `New tab`): `Open collection… ⌘T`, `New script`, `New aggregation on {collection}` (disabled without a collection tab in front). It replaces the `+ Script` text button, which was the strip's only way to make a tab and offered one kind of three.
- The tab menu gains `Reopen closed tab` (§14.8).
- The close control has a tooltip, `Close tab ⌘W`.

### 14.5 View header

Keeps the tablist semantics of §7's "Collection view strip" (`aria-label="Collection view"`, one tab stop, arrow keys) and changes what is drawn.

- Labels in sentence case: **Documents**, **Aggregation**, **Schema & indexes**. The third was "Structure", a word nobody searches for; the palette already said "Go to schema" and "Go to indexes". The stored `activeView` value stays `structure`, so no tab state migrates.
- `⌥1`, `⌥2`, `⌥3` select the three views, shown in each tab's tooltip.
- At the right, muted: `{n} documents · {n} indexes`, then the data size when the server reports it. A figure the server did not report is left out, as today.

### 14.6 Status bar

A 24px band along the bottom of the window (`aria-label="Status bar"`), hidden on the welcome canvas.

- **Left**: `● {connection} · {host} · v{version}` for the Focused Tab's Connection, with a `Read-only` badge when set. The version shows only while connected.
- **Middle**, for a collection tab on Documents: the last run as `{n} documents · {duration} · {plan}`. The duration is always shown. The plan badge moves here from the result bar; activating it opens the plan in the Inspector ([W05 §9.7](./W05-query-bar.md)). While a query runs it reads `Running · {elapsed}`; after a cancel, `Cancelled after {elapsed}` for a few seconds. When the results are not current the count carries a warning dot.
- **Right**: the pager ([W07 §7](./W07-pagination.md)).
- On a script or server tab, and on the Aggregation and Schema & indexes views, the middle and right are empty.

### 14.7 A Connection open, no tab

The canvas shows a 560px column: `{connection} is connected`, up to eight of its collections by name (with document counts when the navigator already knows them) as rows that open a tab, and `Search collections ⌘P`. The old state told the user to "select a collection from the sidebar" above a button reading "Open a collection" that opened a modal: two instructions for one step.

### 14.8 Reopen closed tab

- The renderer keeps the last ten closed tabs of the session: kind, Connection, namespace and state.
- `Reopen closed tab` (⌘⇧T, and the tab menu) reopens the newest one with its state. An entry whose Connection no longer exists is dropped.
- Closing a script tab that holds any source shows an 8-second toast, `Script tab closed`, with **Undo**, which is the same reopen. A script is the one thing in the app a user writes freehand and cannot get back.
- The list is not persisted: a relaunch starts it empty.
- §11 listed ⌘⇧T as "open an aggregation tab"; that binding was never built and this replaces it.

### 14.9 Preview tab

- A single click on a navigator collection opens it in the **preview tab**, drawn with an italic label. The next single click on another collection replaces it, so browsing a database to find the right collection leaves one tab, not one per click.
- The preview tab is **kept** (drawn upright, never replaced) by: a double-click or Enter on the navigator row, a double-click on the tab, any change to its state (filter, sort, options, view, a pipeline edit), pinning it, or dragging it.
- ⌘-click opens a kept tab. Clicking a collection that already has a tab focuses that tab.
- There is at most one preview tab. Which tab it is lives in renderer memory; after a relaunch every restored tab is kept.

### 14.10 Restore and focus

- After a launch restore, when the Focused Tab is a collection tab on Documents, its Connection is connected and its query can run, it runs once, whatever its filter. Other tabs stay lazy.
- Focus then rests in that tab's filter editor rather than on `<body>`.
- After a Connection is opened from the palette with no tab in front, focus moves to that Connection's root in the navigator.

### 14.11 Keyboard

Supersedes §11.

| Shortcut | Action |
| --- | --- |
| `⌘T` | Open collection (the §8 modal) |
| `⌘⇧T` | Reopen closed tab |
| `⌘W` | Close the Focused Tab |
| `⌘1`…`⌘9` | Switch to the Nth tab on screen |
| `⌘⌥→` / `⌘⌥←` | Next / previous tab |
| `⌘K` / `⌘P` | Palette / palette on Collections |
| `⌘B` | Toggle the sidebar |
| `⌘⇧B` | Toggle the Query Builder (the Inspector's Filter tab) |
| `⌘L` | Focus the filter |
| `⌘↓` | From the filter, move to the first result row |
| `Esc` | From the results, back to the filter |
| `⌥1` / `⌥2` / `⌥3` | Documents / Aggregation / Schema & indexes |
| `⌘E` | Manage connections |
| `` ⌃` `` | Toggle the Console |

- `⌘B` used to toggle the Query Builder. The sidebar takes it because that is what the key means in every editor the audience uses; the builder moves to `⌘⇧B`.
- None of these fire while a dialog is open. `⌥1`–`⌥3` are ignored while focus is in a text field, where Option-digit types a character on several keyboard layouts.
- Every shortcut is listed in the cheat sheet and shown in the tooltip of the control it drives.

### 14.12 Server tab

A fourth tab kind, `server`, hosts a Connection's Overview, Monitor, Collections, Users and Roles ([C05 §11](./C05-connection-manager-shell.md)). At most one per Connection.

### 14.13 Acceptance criteria

- The Focused Tab's Connection, database and collection each appear once in the title bar, as breadcrumb segments, and nowhere in the view header.
- Each breadcrumb segment opens its list: the Switcher, the Connection's databases, the sibling collections.
- With a Connection open and no tab, the bar reads `{connection} › Choose a collection…` and the canvas lists that Connection's collections.
- With no saved Connection, the breadcrumb, tab strip, navigator and status bar are absent.
- The search field opens the palette, by click and by ⌘K.
- The title bar has no theme toggle.
- Two open tabs on collections of the same name show `database.collection`; closing one returns the other to the bare name.
- New script tabs are titled `Script 1`, `Script 2`; closing `Script 1` leaves `Script 2` named as it was.
- The group chip is absent with one Connection's tabs open and present with two.
- `+ ▾` offers Open collection, New script and New aggregation; the last is disabled without a collection tab.
- The view tabs read Documents, Aggregation, Schema & indexes; a tab stored with `activeView: 'structure'` opens on Schema & indexes.
- The status bar shows the Connection, the last run with its duration, and the pager; it shows `Running · {elapsed}` during a run.
- ⌘⇧T reopens the most recently closed tab with its filter or source; the toast's Undo does the same for a script tab.
- A single click on a second navigator collection replaces the preview tab; editing the filter keeps it.
- After a relaunch the Focused Tab runs once and focus is in its filter.
- ⌘B toggles the sidebar and ⌘⇧B the Query Builder; neither acts under an open dialog.

### 14.14 Test cases

- **Unit**: the tab label rule (bare name, `database.collection` on a clash, back again); the next script title; the closed-tab list (cap of ten, newest first, entries of a deleted Connection dropped); the breadcrumb model for each state (collection, script, server, no tab, no open Connection, none saved).
- **Component**: breadcrumb segments and their dropdowns; the no-tab canvas; the group chip appearing with a second Connection; `+ ▾`; the view header labels and ⌥1–3 (ignored in a text field); the status bar's three regions and its running state; reopen from the menu, the key and the toast; the preview tab being replaced, and kept by an edit; ⌘B and ⌘⇧B, each inert under a dialog.
- **E2E**: connect, open two same-named collections from two databases and read both tab labels; browse three collections by single click and end with one tab; close a script tab and reopen it with its source; relaunch and find the Focused Tab run and the filter focused.
