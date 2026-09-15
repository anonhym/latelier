# X06 — Contextual feature hints

## Purpose

Make non-obvious features discoverable at the moment a user would want them. The diagnostic for this spec is concrete: the project's own developer could not find how to configure document references (X05) without reading the source. The fix is not a one-time guided tour — it is small, dismissible, anchored callouts that fire when the user is in the right context, persist their dismissal, and stay out of the way otherwise.

## Scope

- **In**: hint registry, `<FeatureHint>` popover component, `useFeatureHint(id, when)` hook, dismissal persistence in `app_state`, an initial catalog of three hints (configure references, pin a tab, save a query), and a "Reset hints" action in Settings.
- **Out** (deferred):
  - Full command palette / Cmd-K — specified in [X07](./X07-command-palette.md); since shipped.
  - Multi-step tours (next / back / skip).
  - Telemetry on hint impressions / dismissals.
  - Hint authoring UI — the catalog is a code-defined constant in v1.

## Dependencies

- F02 (`app_state` table) — already in place.
- X01 (`prefs:get`, `prefs:set`) — already in place.
- X05 (document references) — provides the first hint's trigger surface.
- W09 (saved queries) — provides the third hint's anchor.

## 1. Types

```ts
// shared/types.ts (runtime-free)

export type FeatureHintId =
  | 'refs.configure'
  | 'tabs.pin'
  | 'saved.create'
  | 'palette.discover';

export interface FeatureHintDismissalState {
  dismissedIds: FeatureHintId[];
  resetAt?: string; // ISO; bumped when the user clicks "Reset hints"
}
```

```ts
// src/hints/registry.ts (renderer-only)

export interface FeatureHint {
  id: FeatureHintId;
  title: string;          // <= 60 chars
  body: string;           // <= 200 chars, plain text
  cta?: { label: string; onClick: () => void }; // optional primary action
  placement?: 'top' | 'bottom' | 'left' | 'right';
}
```

The trigger condition (`when`) is not stored in the registry — it's evaluated at the call site via `useFeatureHint(id, when)` because the conditions reference live UI state (current tab kind, query results, click counts).

## 2. Persistence

Single `app_state` key:

| Key                   | Shape                              |
| --------------------- | ---------------------------------- |
| `ui.hints.dismissed`  | `FeatureHintDismissalState`        |

Dismissal is permanent until the user clicks **Settings → Reset hints**, which clears `dismissedIds` and bumps `resetAt`.

No new IPC channels. The renderer uses the existing `api.prefs.get` / `api.prefs.set` with the new key. Typed helpers go on `window.atelier.prefs`:

- `prefs.getDismissedHints(): Promise<FeatureHintDismissalState>`
- `prefs.dismissHint(id: FeatureHintId): Promise<void>`
- `prefs.resetHints(): Promise<void>`

These are thin wrappers around `prefs.get`/`prefs.set`; no router changes needed beyond exposing them on the bridge.

## 3. Renderer architecture

### `HintsProvider`

Top-level context that:

1. Loads `ui.hints.dismissed` once at mount via `api.prefs.getDismissedHints`.
2. Exposes `{ isDismissed(id), dismiss(id), reset() }`.
3. Coordinates **at most one visible hint at a time**: maintains a `currentlyVisibleId` ref. A second hint that wants to render while another is up stays mounted but renders nothing until the first dismisses.

Provider lives in `src/pages/App.tsx` so every page sees it. State is in-memory; the source of truth is `app_state` via prefs.

### `useFeatureHint(id, when)`

```ts
function useFeatureHint(
  id: FeatureHintId,
  when: boolean,
): { visible: boolean; anchorRef: RefObject<HTMLElement>; dismiss: () => void };
```

- `visible` is `true` only when: registry has the id, `isDismissed(id)` is false, `when` is true, and the provider's "one at a time" gate allows it.
- `dismiss()` calls `api.prefs.dismissHint(id)` and updates the provider's set.
- The hook does **not** poll — `when` is reactive, so the parent component recomputes it from React state.

### `<FeatureHint>`

Anchored popover (use existing popover primitive from X05's `ReferenceHoverPopover` if portable; otherwise a sibling). Renders:

- Title (bold, single line).
- Body (1–2 lines).
- Optional CTA button on the left, "Got it" on the right.
- Close (`×`) in the corner — same effect as "Got it".

Click-outside does **not** dismiss — only explicit "Got it", CTA, or `×` does. This avoids accidentally clearing a hint the user didn't read.

### Settings panel

Add a single row to the existing Settings UI: **Hints** — `[Reset hints]` button. Clicking it calls `api.prefs.resetHints()` and shows a 2-second toast "Hints reset — you'll see them again as you use the app."

## 4. Initial catalog (v1)

| Id                | Title                              | Body                                                                                                  | Trigger (`when`)                                                                                                  | Anchor                                  | CTA                                |
| ----------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| `refs.configure`  | Link this field to another doc?    | Fields ending in `_id` or `Id` can become clickable references. Configure a rule to follow them.       | Active tab is a collection tab, last run returned ≥1 row, ≥1 visible field matches `/(.+)(_id\|Id)$/`, and no enabled rules exist for the collection. | "References" button above ResultViewer  | "Configure references" → opens editor |
| `tabs.pin`        | Pin this tab                       | Pinned tabs survive app relaunch and stay out of the LRU. Right-click any tab to pin it.               | Session tab-switch counter ≥ 3 and the user has zero pinned tabs.                                                  | The active tab in the tab strip         | none (close-only)                  |
| `saved.create`    | Save this query                    | Run something useful? Save it for one-click reuse — `Cmd+S` works here.                                | Same `(connectionId, dbName, collection, queryHash)` was just executed for the 3rd time in this session.           | The "Save" button on the query toolbar  | "Save now" → opens save dialog     |
| `palette.discover`| Find any action with ⌘K            | Press ⌘K (Ctrl+K on Windows/Linux) to search every action — switch connections, run queries, configure references, and more. | The user has not opened the palette this session (`getSessionEventCount('palette', 'opened') === 0`).               | The `⌘K` button in the title bar         | "Try it" → opens the palette       |

`queryHash` is a stable hash over `(filter, projection, sort, limit, skip)` — already computed for the recents feature; reuse.

The session-scoped counters (`tabs.pin`, `saved.create`, `palette.discover`) live in `HintsProvider` memory and reset on app start. They are **not** persisted — once you dismiss, the counter is moot.

## 5. Behavior

- Hints that the user has dismissed never re-render until **Reset hints**.
- Only one hint visible at a time — first one to satisfy its trigger wins; the others wait silently.
- Hints are passive: showing one never blocks input, never moves focus, and never animates the underlying UI.
- A hint must not appear within the first 1.5 s of a renderer mount — gives the layout time to settle so the popover doesn't visibly jump.
- All copy lives in the registry constant. No translation layer in v1.

## 6. Error handling

- `prefs.getDismissedHints` failure → assume empty dismissed list (fail-open: better to over-show than to wrongly suppress).
- `prefs.dismissHint` failure → keep the hint dismissed in memory for this session, log via `electron/log.ts`. The next session may reshow it; that's acceptable.

## 7. Acceptance criteria

- [ ] `ui.hints.dismissed` round-trips through `app_state` (set, relaunch, get returns the same value).
- [ ] `prefs.getDismissedHints` / `prefs.dismissHint` / `prefs.resetHints` are exposed on `window.atelier.prefs` and typed in `shared/ipc.ts`.
- [ ] On a collection tab whose results contain an `_id`-suffixed field and which has no reference rules, the **References** button shows the `refs.configure` hint exactly once.
- [ ] Clicking "Got it" dismisses the hint and it does not re-appear after relaunch.
- [ ] Clicking the CTA dismisses the hint and opens the references editor in the same gesture.
- [ ] After three tab switches with zero pinned tabs, the `tabs.pin` hint anchors to the active tab.
- [ ] After running the same query three times, the `saved.create` hint anchors to the Save button.
- [ ] If two trigger conditions become true simultaneously, only one hint is rendered; the other waits.
- [ ] Settings → Reset hints clears the dismissed list and the next eligible trigger reshows its hint.
- [ ] No hint appears within 1.5 s of cold renderer mount.

## 8. Test cases

### Unit
- `hints-registry.spec.ts` — registry contains every `FeatureHintId`; copy lengths within bounds; placements valid.

### Integration
- `hints-prefs-roundtrip.spec.ts` — `prefs.dismissHint('refs.configure')` then `prefs.getDismissedHints()` returns `{ dismissedIds: ['refs.configure'] }`; `prefs.resetHints()` clears it and bumps `resetAt`.

### Component
- `feature-hint.spec.tsx` — `<FeatureHint visible>` renders title/body/CTA; "Got it" calls `dismiss`; `×` calls `dismiss`; click-outside does **not** call `dismiss`.
- `hints-provider.spec.tsx` — when two hooks request visibility at once, only the first renders; dismissing it lets the second appear.
- `refs-configure-hint.spec.tsx` — mocked workspace tab with ObjectId-bearing rows and no rules → hint visible; with rules present → hint hidden; after dismiss → hint hidden on re-render.

### E2E
- `hints-persist.e2e.ts` — trigger `refs.configure`, click "Got it", relaunch app, reproduce trigger conditions, assert hint does **not** reappear. Then Settings → Reset hints, assert it does reappear.
