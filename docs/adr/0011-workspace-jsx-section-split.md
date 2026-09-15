# The Workspace JSX split takes hook objects, not loose props

## Status

accepted, with a correction after implementation (see below)

## Context

`Workspace.tsx`'s JSX body is the largest remaining block. The naive
extraction — one component per section, every value passed as its own prop —
produces a 30-prop interface that is worse than the inline JSX it replaces, and
is exactly the "review churn" this ticket warns about.

**Measured closure surface** (identifiers in each region that resolve to a
component local; some are arrow-function params, so these are upper bounds):

| Section | Lines | Region | Locals referenced |
| --- | --- | --- | --- |
| Shell scaffold — `AppShell.Header` + `AppShell.Navbar` | 176 | 1532–1707 | ≤23 |
| Panel body — `AppShell.Main`, **both** `PanelGroup`s | 401 | 1708–2108 | ≤33 |
| Dialog stack — `NewTabPicker` … `ConnectionExpandedTable` | 172 | 2109–2280 | ≤21 |

## Decision

Three sections, matching this ticket's own naming. Each takes the
**hook-result objects wholesale** — `useDocumentDialogs()`, `useConnectionDialogs()`,
`useNavigatorDialogs()`, `useWorkspacePanelPrefs()`, `useCollectionTabActions()` each
return one cohesive object already — instead of destructuring them into loose props
at the boundary. That collapses ~20 props to a handful and keeps the seam readable
as "this section owns these concerns".

Scope is **not** narrowed. All three sections come out.

**Open question the implementer must answer, not assume.** Passing a hook result
wholesale means a fresh object identity every render. For the drawers in an earlier ticket that
was provably harmless — they are unmemoized leaves. **That reasoning does not
transfer here**: these sections wrap `PanelGroup` / `Panel` from
`react-resizable-panels`, third-party components that may memoize internally.
Required in the PR: state whether any section was wrapped in `React.memo`, and if
so, that passing a fresh hook object defeats it. Either answer is fine. Silence is
not.

**Required report, per section:** the final prop list. That is how we see whether
"pass the hook object" actually collapsed the surface or just smuggled fifteen
loose props in beside it.

## Consequences

**The guardrail with no size-based test — this is the one that ships silently.**
jsdom stubs `ResizeObserver` to a no-op (`tests/helpers/jsdomSetup.ts`), so
`react-resizable-panels` never serialises a size. Deleting or relocating a
`PanelGroup` `key` passes the **entire** suite and produces layout shift on every
launch. Two clauses, both hard:

1. `key={`v-${String(prefsReady)}`}` (line 1723) and `key={`h-${String(prefsReady)}`}`
   (line 1828) survive **on the elements they are on now** — not hoisted to a
   wrapper, not pushed onto an extracted child's root.
2. `tests/component/workspace-panel-prefs.spec.tsx` passes **untouched**. It guards
   this by DOM-node identity plus a control assertion outside the group. Needing to
   edit it is a signal to report, not a chore to absorb.

**`useWorkspaceTabs()` stays at exactly one call site** (`Workspace.tsx:442`). A
worker extracting a section that needs tab state will reach for the hook instead of
threading the value; CLAUDE.md is explicit that a second call "creates a
disconnected copy". `grep -rn 'useWorkspaceTabs()' src` is a pre-push check, not
just a prohibition.

**Also untouched:** `tests/component/workspace-actions-identity.spec.tsx` (an earlier ticket's
guardrail) and `tests/component/use-collection-tab-actions.spec.tsx` (another earlier ticket's).

## Correction after implementation (2026-08-24)

Two things the implementation got right that this ADR got wrong. Recorded rather
than quietly edited, because the ADR is what the next ticket reads.

**1. `useNavigatorDialogs()` is not available at this boundary — my error.**
This ADR listed it among the five hooks to pass wholesale. It is called inside
`DbCollectionNavigator.tsx:672`, not in `WorkspaceInner`, so none of the three
sections can consume it. Four hook objects were available here, not five.

**2. `PanelBody` did not meet this ADR's own bar, and that is not the
implementer's miss.** The stated test was:

> Required report, per section: the final prop list. That is how we see whether
> "pass the hook object" actually collapsed the surface or just smuggled fifteen
> loose props in beside it.

Run that test honestly: `ShellSection` takes 18 props, `DialogStack` 19,
`PanelBody` **31** — four hook objects plus ~27 loose values. For `PanelBody` the
answer is that the surface did not collapse.

Accepted anyway, and the reasons are worth stating so this is not read as a
standard being waived:

- The diff is a **verbatim JSX move** with no logic change, and every guardrail was
  proven still live by mutation rather than assumed.
- `Workspace.tsx` went 2298 → 1227 lines. The win is real and independent of the
  prop count.
- Blocking a chain that carries a P1 silent-data-loss fix on prop ergonomics
  would be the wrong trade.

**There is a real reduction path, so this is a follow-up and not the shape of the
problem.** `CollectionWorkspaceProvider` already takes a `{state, actions, meta}`
triple, and `workspaceActions` / `workspaceMeta` are threaded through `PanelBody`
as separate props solely to be handed to it at `PanelBody.tsx:361`. Hoisting the
provider, or passing one `workspace` object, removes several props without
inventing an abstraction. Filed separately; not a blocker of the base branch.
