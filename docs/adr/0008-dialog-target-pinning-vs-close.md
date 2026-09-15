# Dialogs that hold unsaved input pin their target; dialogs that do not, close

## Status

accepted

## Context

`DeleteConfirm`, `EditDrawer` and `InsertDrawer` all read
`connectionId` / `dbName` / `collection` live from `activeCollection` at render
time, while the state that opens them is set once at open time. Any focus change
retargets the dialog. One filed case was the delete bug: a confirm collected against tab A
spent its Delete on tab B's collection. A follow-up filing covered the same hazard for Edit/Insert.

## Decision

Two different remedies, chosen by whether the dialog holds
user-typed input.

| Dialog | Holds unsaved input | Remedy on a Focused Tab change |
| --- | --- | --- |
| `DeleteConfirm` | no — a confirmation, nothing typed | **close** (`closeDeleteDialogs`, keyed on `activeTabId`) — shipped |
| `EditDrawer` | yes — an in-progress document edit | **pin the target at open time** |
| `InsertDrawer` | yes — a drafted document | **pin the target at open time** |

**Why not one policy for both.** Closing Edit/Insert on a tab switch silently
discards the user's draft — a usability regression traded for a correctness one.
Pinning `DeleteConfirm` instead of closing it would leave a confirmation
collected against one collection still armed after focus moved away, which is
the state the user was never asked about.

**Shape of the pin.** The target travels *with* the payload in one state atom
rather than in a parallel atom, so an open drawer without a target is not
representable:

```ts
type DocTarget = { connectionId: string; dbName: string; collection: string };

// replaces `editDoc: unknown | null`
const [editing, setEditing] = React.useState<{ doc: unknown; target: DocTarget } | null>(null);
// replaces `insertOpen: boolean` (+ `duplicateDocJson` stays as-is or folds in)
const [inserting, setInserting] = React.useState<{ target: DocTarget } | null>(null);
```

Two parallel atoms (`editDoc` + `editTarget`) were rejected: they can desync, and
arguing they cannot is exactly the reasoning `deleteMode.ts` got wrong in the delete bug
("unreachable behind the modal" — the modal was never a barrier).

## Consequences

Both deliberate.

1. The `activeCollection &&` guard drops out of both drawer render sites. A
   drawer opened on a collection tab now survives a switch to a Script tab
   instead of unmounting and losing the draft. This is a behaviour change and
   owes a test.
2. If the pinned Connection is disconnected while the drawer is open, the save
   fails at the IPC boundary. That is acceptable — a visible error beats a
   silent wrong-collection write, which is the whole bug class here — but the
   failure must be *visible*, not swallowed. Verify it surfaces.
3. `useDocumentDialogs` now carries two policies for the same event. Comment the
   asymmetry in the hook or the next reader will "fix" it into one.

**Unchanged.** The external action names consumers see —
`openEdit(doc)` / `openInsert()` / `openDuplicate(doc)` on the workspace actions
context — keep their signatures. The target is captured inside the hook from
`activeCollectionRef.current`; callers never pass one.
