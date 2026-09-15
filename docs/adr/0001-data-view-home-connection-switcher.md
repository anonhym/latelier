# Data View is home; connections are managed via an in-view switcher popover

## Status

accepted, and **partly superseded by
[ADR 0006](./0006-multi-connection-data-view.md)**.

Still current: the Data View is the app's home, and the standalone
`/connections` list-sidebar screen stays retired.

No longer current: the single **Active Connection** this ADR chose. ADR 0006
moved connection identity onto the tab, so the "Multi-connection now"
rejection recorded below and the `ui.workspace.activeConnectionId` state it
implied are both retired.

Every superseded passage is struck through in place, including inside the
Decision section — read the strikethroughs as history, not as policy.

## Context

The app previously opened to a full-page connection-management screen (`/connections`): a
connection-list sidebar plus a rich detail panel (Overview, Collections, Indexes, Users,
troubleshooting). Getting into the Data View was a separate full-page navigation, and the Data
View had no in-view way to switch or add a connection — it bounced back to `/connections` when
there were none. This made the connection screen a place users *land on* rather than *go to*, and
put the primary task (exploring data) one navigation away.

## Decision

Make the **Data View the app's home** and manage connections from within it via a lightweight
**Connection Switcher** popover, rather than a separate landing screen.

- **Home**: `/workspace` is the durable home. ~~Launch restores the last Active Connection and its
  tabs.~~ **Superseded by [ADR 0006](./0006-multi-connection-data-view.md)** — launch restores every
  tab, and only the Focused Tab's Connection connects; the rest stay Dormant. With zero connections
  — or any time no connection is open (after disconnect, or an
  unrestorable relaunch) — the Data View shows a centered empty state and the TitleBar shows a
  "Select a connection ▾" trigger; both open the switcher (add-mode when zero connections exist).
- **Switcher popover**: anchored off the connection name in the TitleBar (navigator connection
  header is a secondary trigger). It is the one canonical list of saved connections (filterable;
  name, color dot, live-status dot, active marked) with a `＋ Add connection` row and a per-row
  `⋯` (Manage / Edit / Disconnect / Delete).
- **Switching**: ~~clicking a connection makes it active and connects immediately; the previous
  connection's tabs close silently (no confirm), matching the existing `closeAll` behavior.~~
  **Superseded by [ADR 0006](./0006-multi-connection-data-view.md)** — Connections coexist, and
  only Disconnect closes tabs. Switching no longer does.
- **Add / Edit**: reuse the existing 5-tab `NewConnection` form as a **modal** over the Data View
  (form body extracted from its page chrome). ~~On create, the new connection becomes active.~~
  **Superseded by ADR 0006** — there is no single active Connection to become.
- **Deep management**: `/connections/:id` is kept as a deep, bare detail screen (Overview /
  Collections / Indexes / Users / troubleshooting), with a back-button to the Data View. Reached
  via a "Manage connection…" row action — the popover's, or the expanded Connections table's
  (added later by the Switcher rework); never landed on directly.

## Considered Options

- **Multi-connection now** (coexisting navigator roots, tabs across connections) — rejected for
  this rework. Single Active Connection is retained; multi-connection remains a separate, larger
  future effort. The tab data model already stores `connectionId` per tab, so this is a scope
  choice, not a technical block. **Superseded by [ADR 0006](./0006-multi-connection-data-view.md)**,
  which takes that separate effort on: Connection identity moves onto the tab and the single
  Active Connection is retired.
- **Delete the connection-management surface entirely**, rehoming Indexes/Users/troubleshooting
  into the Data View — rejected as too large. The detail screen is demoted (deep-link only), not
  deleted.
- **Centered modal / command-palette-style switcher** instead of an anchored popover — rejected;
  the connection name is the always-visible "where am I" indicator and switching should be a quick
  flick, not a focus-stealing modal.

## Consequences

- The standalone `/connections` **list-sidebar screen is retired**. Its **bulk-delete** affordance
  is dropped in favor of per-row delete. (The popover was originally to be the *only* connection
  list; the prototype changed that — see Prototype findings.)
- The `⌘K` command palette should gain "Switch connection → X" commands that route to the same
  switch action.
- The `NewConnection` form must be usable as a modal — its body is decoupled from page chrome
  (consistent with the X11 workspace-composition direction).
- The renderer gains a notion of the Active Connection that the Data View and switcher share.
  (Retired by [ADR 0006](./0006-multi-connection-data-view.md) — identity moved onto the tab.)

## Prototype findings (2026-07-25)

Three variants of the popover were built against the real Data View and judged live.
Primary source: branch `poc/connection-switcher-popover`, `src/pages/Workspace/prototype/`
(throwaway — not merged).

**The popover is a search, not a menu.** Variant C won: a persistent search field in the top
slot, matching **name and host**, with a flat keyboard-driven list beneath it. This refines the
Decision above, which described a menu-shaped list that happened to be filterable.

- **Search is always visible.** A threshold ("show the filter past N connections") was tried and
  rejected — it makes the popover's shape change under you as you add connections.
- **No per-row `⋯`.** The Decision's Manage / Edit / Disconnect / Delete menu is replaced by
  inline icon actions on the highlighted row, plus a keyboard path: `↑↓` navigate, `⏎` connect,
  `⌘⏎` manage, `⌫` disconnect.
- **Status reads as a row-edge band**, not a third small dot competing with the color dot.
- **Rejected: grouping instead of search** (variant B — active connection promoted to a card,
  Connected / Recent / All sections). Sections did not earn their vertical space against typing
  three letters. Two-line rows exposing `host:port` were the one idea worth keeping from it, and
  they survive in the expanded table below.

**The popover gains an expanded surface — this changes a Consequence.** `⌘E` (or `expand ⤢` in
the footer) opens a **search-first table modal**: the same search on top, then every connection's
name / host / type / status / last-used visible at once, detail expanding inline under the
selected row, and Connect / Edit / Collections & indexes… / Delete in a footer bar acting on the
selection. It exists because a popover cannot compare two similar connections
("Prod — US East" vs "Prod — EU West") or hold detail, edit and delete comfortably.

Consequence: **the popover is no longer the only connection list.** The expanded table is a
second, deliberate one. `/connections/:id` remains the deep detail screen, but "Manage
connection…" now routes through the expanded table rather than being the only way to see
connection detail. The retirement of the old `/connections` list-sidebar screen still stands.

Open: whether the expanded table subsumes enough of `/connections/:id` that the deep screen
should shrink to just Collections / Indexes / Users.
