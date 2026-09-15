# Multi-connection Data View: identity moves from the view to the tab

## Status

accepted — supersedes the "Multi-connection now" rejection in
[ADR 0001](./0001-data-view-home-connection-switcher.md)

## Context

ADR 0001 deliberately kept a single **Active Connection**: the Data View browsed one
Connection at a time, and switching closed the previous Connection's tabs silently. It
recorded that as a scope choice, not a technical block — "the tab data model already stores
`connectionId` per tab".

That has held up. Every main-process service is already keyed by `connectionId`, and
`MongoPool` is already a `Map<string, Entry>`. The only thing enforcing one Connection in the
main process is a preemption loop in `MongoPool.connect()` that disconnects every other
connected/connecting entry. In the renderer, the enforcement is the tab teardown on switch —
which means deleting the pool loop alone changes nothing a user sees.

SSH tunnelling is not implemented, so there is no per-connection port allocation to consider.

## Decision

Run **many Connections at once**, and move Connection identity from the view onto the tab.

- **Identity is on the tab.** There is no Active Connection. The **Focused Tab**'s
  `connectionId` answers "where am I". One shared tab strip holds tabs from different
  Connections. `workspace_tabs` keeps one global `is_active` row and one global `position`
  order, so **no migration is owed**.
- **One navigator root per Connection**, rather than one root for the active one.
- **Tabs group by Connection inside the one shared strip**, behind a named Connection chip, and a
  tab can only be dragged within its own group. Grouping is presentation over a single global
  `position` order; the constraint is what keeps a drop landing where the user dropped it.
- **Disconnect closes that Connection's tabs, after a confirmation**, and removes its
  navigator root. Disconnect is the only action that closes tabs; switching no longer does.
- **A Connection that drops on its own becomes Dormant** — the root greys, the tabs survive,
  one click reconnects. Disconnect (the button) and disconnected (the state) therefore do
  deliberately different things, and that asymmetry is intentional: an explicit action gets an
  explicit consequence, a failure preserves the user's place. There is no confirmation to show
  for a network blip, and closing six tabs because Wi-Fi dropped is the opposite of what this
  change is for.
- **A connect can be cancelled.** A `connecting` row in the switcher gains a Cancel that calls
  `disconnect(id)`. This replaces the escape hatch the preemption loop provided: connecting to
  B used to force-close a hung connect to A and drain the driver's wait queue.
- **A tab does not imply a live client.** At launch, only the Focused Tab's Connection
  connects. The others restore as **Dormant Connections** — the same state an involuntary drop
  produces: a collapsed, greyed navigator root showing no Databases, no Collections and no
  documents, plus their tabs. Clicking a tab or
  expanding a root connects it. Launch cost stays flat as tab count grows.
- **Clicking a Connection in the Switcher connects only.** It adds an expanded navigator root
  and opens no tab — opening one would mean guessing a Database and Collection. The switcher's
  "active" marker becomes a "connected" marker.
- **The Read-Only marker moves onto the tab and the navigator root.** One title-bar marker is
  a lie with several Connections open. The enforcement props come from the Focused Tab's
  Connection.
- **A failed connect surfaces on the navigator root**, with Retry, and closes nothing. One
  error surface for all three entry points (switcher row, tab click, root expand).
- **Deleting a Connection with open tabs keeps one confirmation**, its existing one, with the
  tab count in the body.
- **`ui.workspace.activeConnectionId` is retired.** The Focused Tab already carries that
  identity and `is_active` is already persisted per row. The one case the pref covered and
  tabs do not — a Connection left connected with no tabs — is a Connection you were not using.

## Considered Options

- **Identity on the view** — keep Active Connection, narrowed to "what new tabs open against",
  with per-connection tab groups. Rejected: `is_active` and `position` are global today
  (`clearActiveStmt` is a bare `UPDATE workspace_tabs SET is_active = 0`), so this owes a
  migration and a second layer of grouping state, to answer a question the Focused Tab already
  answers.
- **Connect every Connection that has tabs at launch** — keeps the simple rule "a tab you can
  see is a tab you can click". Rejected: N connects, N error paths, and one unreachable host
  delaying every launch.
- **Leave the tabs as dead tabs on explicit disconnect** rather than closing them — rejected: a
  Dormant root with no tabs under it is a row the switcher already shows, and the user asked for
  the Connection to go away. The involuntary case is decided the other way on purpose, above.
- **Close the tabs on an involuntary drop too**, for one rule instead of two — rejected; it
  destroys work on a transient failure and cannot ask first.
- **A toast for a failed connect** — rejected; transient, and unreadable if the user started
  three connects.

## Consequences

- `src/state/activeConnection.ts` is a one-value store with a comment saying "one value, one
  publisher". It becomes the Focused Tab's Connection, and `PaletteContext` follows.
- The switch machinery in `src/pages/Workspace.tsx` — `switchToConnection`, `switchConnection`,
  the generation token, the in-flight refcount, and `closeAll(keepConnectionId)` with its
  "close all *except* this one" semantics — is mostly deleted rather than
  rewritten. `closeAll` becomes "close this Connection's tabs".
- The two `'connection canceled'` guards in `MongoPool` stop being dead defence and become the
  Cancel path.
- The navigator must gate its render on the existing `isConnected` flag, not on its
  per-connection cache, so a Dormant root shows nothing. Only the per-Connection *expanded*
  boolean is persisted, so a launch-restored Dormant root has no data to leak anyway.
- Read-only stays safe. Per [ADR 0005](./0005-read-only-connection-enforcement.md) the
  enforcement is in the main process and already keyed by `connectionId`; the renderer's
  `connectionReadOnly`/`readOnly` props are UX only. N open Connections weaken nothing — the
  badge is a label, never the guard.
- ADR 0001's command-palette consequence changes wording: "Switch connection → X" becomes
  "Open connection → X".
- 14 test files pin the single-Active-Connection invariant and must be reworked with the change.
- The tab strip needs per-tab Connection identity (colour or badge) — the part judged by eye,
  and the reason a `/prototype` detour precedes implementation.

## Prototype findings (2026-08-18)

Four variants were built against stub data covering every state above — two Open, one Dormant,
one connecting with Cancel, one failed showing its error on the root — and judged live. Primary
source: branch `prototype/multi-connection`, `src/pages/Workspace/prototype/` (throwaway — not
merged). Run with `npm run prototype`.

**BS — "Named groups + spine" won.** Tabs cluster in the one shared strip behind a named
Connection chip; the navigator is an accordion, one root expanded at a time; and the
Connection's colour runs as a spine down the left edge of its navigator section — header and
expanded subtree alike — repeated on the strip chip so the tree and the strip share one key.

- **Identity is named, not inferred.** Variant A ("Colour spine") carried identity in colour
  alone, with no Connection name anywhere in the strip. Rejected: colour is a good second cue
  and a bad only cue, and two Connections in the same palette family stop being distinguishable
  at a glance.
- **Colour is a spine, not a dot.** Plain B used a small colour dot. BS replaced it with the
  spine; a dot *and* a spine states the same fact twice. The spine also survives the subtree,
  which a dot on a header row does not.
- **Muted rail for no live client.** Dormant and failed Connections get a grey rail rather than
  their own colour, so "has a live client" is readable without reading the status word.
- **Rejected: the Connection rail** (variant C — a left rail of Connection avatars, always on
  screen, every navigator root visible at once). It buys persistent presence at the cost of a
  permanent 48px column, and with every root expanded the tree competes with itself for vertical
  space. The accordion answers that better.
- **The Disconnect confirm was added mid-prototype** and belongs in the judged set: it is the
  one interaction here that destroys work, and a layout should not be picked without it on screen.

**Tab drag is constrained inside its group.** The strip groups tabs by Connection visually while
`position` stays a single global order, so a drag that crosses a group boundary needs a defined
outcome. A tab can be reordered within its own Connection's group and cannot be dropped into
another's — a tab's Connection is a property of the tab, and dragging is not how you would
change it. The alternative, letting the drop land anywhere and re-sorting the strip underneath
the user, moves the tab somewhere other than where it was dropped. This is a rendering
constraint; it does not reopen the no-migration decision.
