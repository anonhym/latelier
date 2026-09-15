import type { WorkspaceTab } from '@shared/types';

/**
 * Grouping is presentation over the single global `position` order (X16 §5).
 * A Connection's tabs gather into one group; within a group, tabs keep the
 * order `tabs` already holds them (pinned-first, then position) — pinning
 * still floats a tab to the front of its own group.
 *
 * *Which* group comes first, though, is decided by first appearance in raw
 * `position` order, not by `tabs`' pinned-first order. `tabs` puts every
 * pinned tab ahead of every unpinned one globally, so grouping straight off
 * it would drag a pinned tab's whole Connection to the head of the strip
 * whenever some other Connection's tab happens to be pinned too — the
 * pin is supposed to move the tab within its group, not move the group.
 *
 * That only works if `position` really is untouched by pinning end-to-end,
 * so check it against every writer of the `position` column, not just
 * `setPinned`:
 *   - `setPinned`/`WorkspaceTabRepo.setPinned` write the `pinned` column
 *     only — never `position`.
 *   - `WorkspaceTabRepo.insert` writes `position` once, at
 *     `nextPosition()` (current max + 1), when a tab is opened
 *     (`WorkspaceStateService`'s `openCollection`/`openAggregation`/
 *     `openScript`). It only appends past the end — it never touches an
 *     existing row's `position` — so it can't disturb this invariant.
 *   - `WorkspaceTabRepo.reorder` (via its `setPositionStmt`) is the only
 *     writer that can change an *existing* row's `position`, and its one
 *     caller is `reorder()` in `src/state/workspaceTabs.ts`, whose one
 *     caller is `TabStrip.tsx`'s `handleDrop` (wired through
 *     `Workspace.tsx`'s `onReorder={(ids) => void tabs.reorder(ids)}`).
 *     `reorder()` renumbers sequentially in exactly the order of the id
 *     list it's given — so the invariant lives entirely in *what list
 *     `handleDrop` builds*.
 *   - `handleDrop` used to build that list by iterating the pinned-sorted
 *     `tabs` prop, which handed `reorder()` a pinned-first order and
 *     silently broke this exact invariant the moment anyone dragged
 *     within a group after anything anywhere was pinned (a second
 *     way to reintroduce the same class of bug, through `reorder()`
 *     instead of through this function). It now sorts `tabs` by raw
 *     `position` first and only splices the dragged group's own slots,
 *     so every other tab — including another group's pinned tab — keeps
 *     its existing relative `position` order.
 *   - `reorder()`'s own local `setTabs` re-sorts its result pinned-first
 *     (matching `setPinned`'s sort and the server's `ORDER BY pinned DESC,
 *     position ASC`) *after* assigning every `position` value, purely so
 *     the optimistic in-memory render matches the next real load — that
 *     sort touches array order, never a `position` field, so it doesn't
 *     participate in this invariant either.
 *   - `WorkspaceTabRepo`'s load query (`ORDER BY pinned DESC, position
 *     ASC`) only *reads* `pinned` and `position` to decide display order
 *     within a fetched set; it never writes `position`, so it doesn't
 *     participate in this invariant and needed no change here.
 *
 * The strip renders these groups one after another, so flattening this is the
 * order a person reads left to right. Tab cycling calls it too: a
 * second implementation of "the order on screen" is exactly how the cycling
 * order and the rendered order drifted apart.
 */
export function groupTabsByConnection(
  tabs: WorkspaceTab[],
): { connectionId: string; tabs: WorkspaceTab[] }[] {
  const byConnection = new Map<string, WorkspaceTab[]>();
  for (const tab of tabs) {
    const group = byConnection.get(tab.connectionId);
    if (group) group.push(tab);
    else byConnection.set(tab.connectionId, [tab]);
  }
  const connectionOrder: string[] = [];
  const seen = new Set<string>();
  for (const tab of [...tabs].sort((a, b) => a.position - b.position)) {
    if (!seen.has(tab.connectionId)) {
      seen.add(tab.connectionId);
      connectionOrder.push(tab.connectionId);
    }
  }
  return connectionOrder.map((connectionId) => ({
    connectionId,
    tabs: byConnection.get(connectionId)!,
  }));
}
