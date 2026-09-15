# Collection-scoped admin surfaces live in the Data View; cluster-scoped ones stay in the Connection Manager

## Status

accepted

## Context

ADR 0001 made the Data View the app's home and retired the `/connections` list
screen, keeping `/connections/:id` as a deep detail screen reached only via the
Connection Switcher's "Manage connection…". That screen still hosts four tabs:
Overview, Collections, Indexes, Users.

The Indexes tab does not fit there. Its component takes `{ conn, runtime }` and
carries its own database and collection `<select>` pickers, persisting the last
pair to a `ui.indexes.lastTarget` preference — a cluster-level tool that
happens to be about indexes. Meanwhile a user querying a collection in the Data
View has no path at all to that collection's indexes: `ExplainDrawer` will tell
them the query performed a collection scan and then offer nothing, because
index management is a screen away and does not know which collection they were
looking at.

Left unresolved, each new admin surface re-opens the same argument, and the
likely outcome is two hosts for each — one picker-driven, one collection-driven
— which drift.

## Decision

**Collection-scoped admin surfaces live in the Data View, on the collection
they belong to. Cluster-scoped ones stay in the Connection Manager.**

- **Indexes are collection-scoped and move.** The index surface becomes a
  section of the Structure view inside the collection tab (W16 §1.2), taking
  `{ connectionId, dbName, collection }`. Its pickers and its
  `ui.indexes.lastTarget` preference are deleted, and the Connection Manager's
  Indexes tab is removed rather than deprecated.
- **Users are database-scoped and stay.** `UsersTab` has the identical
  `{ conn, runtime }` shape, but MongoDB users belong to a database, not a
  collection. It is untouched.
- **The test for a new surface** is what the operation is scoped to in
  MongoDB, not how the current component happens to be written. A surface that
  needs a collection named to make sense belongs where the user has already
  named one.

## Considered Options

- **Mirror** — keep the Connection Manager's tab and add a second,
  collection-scoped indexes section. Rejected: two routes to one operation is
  exactly the drift this ADR exists to prevent, and it doubles the maintenance
  of a 1000-line component.
- **Split** — extract a shared collection-scoped core, with the Connection
  Manager's tab becoming a thin picker wrapper. Rejected, though defensible: it
  preserves a host that should not survive, and "two thin wrappers" is how both
  end up maintained forever. The extraction is available later if a genuine
  cluster-wide index overview is ever wanted, which is a different feature.
- **Leave it** — add a link from the Data View to the Connection Manager's
  tab. Rejected: it keeps the navigation cost that makes the diagnose→fix loop
  not worth completing, which is the actual problem.

## Consequences

- The Connection Manager loses a tab and moves further toward being only what
  ADR 0001 left it: a deep screen for connection-level concerns.
- Anyone who used the pickers to survey indexes across collections loses that
  path. The pickers were a worse navigator, not an overview; a real
  cross-collection index view would be a separate feature and none is planned.
- `specs/C09-indexes-tab.md` describes a surface that no longer exists as
  specified and is amended by W16 Tier 1. Its references from `C05`, `C08`,
  `PLAN-connections` and `README` must still resolve.
- Four component specs change harness (mount with a namespace instead of
  driving pickers). `IndexService` and the `index:*` channels are untouched —
  if a change reaches them, the work has leaked out of the renderer.
- The rule is stated so the next admin surface is placed without a debate. If
  a future surface is genuinely both — collection-scoped but wanted in
  aggregate — that is the point at which the "split" option above should be
  revisited, deliberately.
