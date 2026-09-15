---
name: crash-fuzz
description: Hunt for crashes, silent data corruption, and regressions by driving the built Electron app through randomized action walks with layered oracles. Use when a refactor or feature touched a surface and you need to find unknown bugs in it, rather than confirm one known change.
---

# Crash-fuzzing the real app

`verify` observes **one known change**. This hunts **unknown** ones.

Read `.claude/skills/verify/SKILL.md` first and do not re-derive what it owns:
build-first discipline, `electron.launch` + `ATELIER_USER_DATA_DIR`, the
ErrorBoundary "Reload" screen, the connection-form traps, the sub-tab-strip and
`Filter…` selector gotchas, `tests/e2e/pages/`. All of it applies here.

The reusable core lives beside this file in `harness.ts` — seeded PRNG, the
oracle stack, the data-delta dump, the biased-draw tally. Copy it into your
scratchpad driver; add an action alphabet and a fixture.

## Build and run

```bash
npm run build && npx playwright test <scratchpad-spec>
```

`npm run test:e2e` hangs in the vite build (~30 min at 0% CPU). Bare
`npx playwright test` runs a **stale** bundle. Only the combination is safe.
Rebuild after every `src/` edit.

Never pipe a long run through `grep` — it buffers and looks wedged. Redirect to
a file, then grep the file.

## The oracle stack — this is why the skill exists

A renderer-only oracle makes a fuzzer lie. All I/O lives in the main process, so
`console.error` + `pageerror` see a rejected promise and nothing else. Check all
five after **every** action:

| # | oracle | catches |
|---|---|---|
| 1 | main-process stderr, scanned for `Uncaught\|UnhandledPromiseRejection\|FATAL\|Segmentation` | native and unhandled faults |
| 2 | `app.process()` exit listener | the app dying |
| 3 | incremental grep of `<userDataDir>/logs/*.log` for `"level":"(error\|fatal)"` | anything `electron/log.ts` recorded |
| 4 | renderer `console.error` + `pageerror` | render crashes, effect throws |
| 5 | **data delta** — namespaces dumped before/after, compared to an expectation | wrong-target writes |

### Oracle 5 is the one that finds the interesting bugs

On a data-mutation surface the interesting failure is **not** a crash. The P1
this skill was written from returned `{ok: true}` with all four crash oracles
silent while it deleted from the wrong collection: a delete confirm read its
target live at render, the user switched tabs, and the confirmation collected
against one collection was spent on another. A crash-only fuzzer reports that
run clean.

So dump ground truth off the bridge before and after, and **assert** the delta:
name which documents should have gone and check that exactly those did. A dump
nobody compares against an expectation is not an oracle.

Seed the same collection name into two databases (`shop.orders`, `depot.orders`)
so a cross-database mistarget stays observable even when a name-based guard is
satisfied.

## Every oracle needs an injected-failure proof, in the same run

A comparison never seen to fire is not evidence. Gate a deliberate fault behind
an env var and prove each oracle fires before trusting a clean result:

```bash
FUZZ_INJECT=1 npx playwright test <spec>   # must FAIL, and name the right thing
npx playwright test <spec>                 # must pass — the guard is inert without the var
```

For the main-process oracle, fire a bad IPC call (an invalid `confirmToken`) and
confirm the log oracle catches what the renderer only sees as a rejected promise.
For the delta oracle, delete from a namespace the dialog was **not** opened on
and confirm it fires *and names the stray namespace*. A proof from a previous run
does not count — the artifacts may differ.

## Making the iteration count mean something

Uniform sampling over all actions spends roughly half the budget on steps whose
preconditions are not met, and a no-op is indistinguishable from a real action in
the trace. Give every action a `can(probe)` predicate, draw only from eligible
ones, and report **LANDED**, never drawn.

Report a blocked-reason histogram alongside, and attribute each block as
driver-side or app-side. A `can()` probe reads state *before* the action runs, so
a DOM change between probe and click leaves a stale precondition — that is a
driver artifact, not a finding.

### Biased chains for multi-step semantics

A uniform walk confirmed **one** delete end-to-end across 77 landed actions —
enough to show the path does not crash, not enough to say anything about what it
deletes. Chaining `selectRow → openConfirm → confirm`, re-probing immediately
before each link, got 7 of 8 chains through all three.

Record a chain as **abandoned at the link where it died**, never folded into a
denominator. "Reached link 2 of 3, eight times" is information; a landed count
that hides where chains die is not.

## Seeded is not deterministic

Identical seeds gave 77 and 76 landed actions on consecutive runs, because
eligibility is a live DOM probe and the seed only picks among *eligible* actions
— so a render landing a few milliseconds differently changes the draw. The
oracle verdict was identical both times.

Consequence: **the seed narrows the search, the logged trace is what replays.**
Say this in any report, or someone files a repro that does not reproduce.

## What to aim at — scope by bug class, not by feature

The transferable class: **state captured at open time whose target is read live
at render, with a context switch in between.** That was true of the delete confirm and
of `EditDrawer`/`InsertDrawer`. Naming the class is what makes this useful
on a surface nobody has fuzzed.

Concrete probes, in rough yield order:

- A dialog open while the entity underneath it is deleted or the tab is switched.
- Two dialogs open at once; Escape during a pending async.
- A route that bypasses the handler you think guards things. The command palette
  binds `mod+K` in Spotlight itself and calls `openCollection` directly, so it
  reaches past a keydown-handler guard entirely — design one action specifically
  to distinguish a convergence-point fix from a per-shortcut guard.
- Debounced-write paths followed by an immediate quit, then relaunch on the same
  `userData` dir.
- Admin dialogs racing a background refresh.

## Known false positives — log and continue, never report

- A freshly created DB is briefly invisible to `listDatabases`, and
  `DbCollectionNavigator` caches the empty result forever. Use
  `WorkspacePage.waitForDb`.
- A flaky `DbCollectionNavigator` retry.
- Always `gh issue list --state open --search "<keywords>"` before reporting. A
  dup is not a finding.

## Fuzz-specific locator traps

Beyond `verify`'s list:

- `TreeView.tsx` renders string values **with literal quotes**, so an anchored
  regex like `/^order-\d$/` never matches the rendered `"order-1"`. Never match
  rows on document content.
- `[data-selected]` on the row wrapper works in both `TreeView` and `TableView` —
  view-agnostic, independent of the fixture, and doubles as a "are there rows?"
  probe.
- `tabByName('orders')` is a strict-mode violation once two databases each hold
  an `orders` collection. That duplicate name is a **deliberate** fixture
  property — it is what keeps a name-based guard satisfied across a
  cross-database switch — so fix the locator, not the fixture. Wait on
  per-namespace seeded content instead; it confirms both which tab is focused and
  that its query ran.
- A bare `[role="tab"]` count picks up the sub-tab strip.

## Lane exclusivity

A concurrent `npm run build` swaps `dist/` and `dist-electron/` under a live
Playwright + Electron session, silently. One agent at a time; an idle
notification is not a stand-down. Record `dist-electron/main.js` mtime alongside
the run so provenance is a fact rather than an assumption.

## What gets committed

**Never the driver.** A nondeterministic spec in `tests/e2e/` is a permanent
flake tax. Commit:

1. A **minimized deterministic** e2e regression test.
2. A fast **component** test — that is what cheaply catches the regression later.

Prove each by breaking the fix and confirming exactly that test goes red. Then
delete the driver and verify `git status --porcelain` is empty.

A finding is an **issue**, not just a PR — file it, link it as a blocker of the
work that found it, and fix it on the same base. See CLAUDE.md's
discovered-issues gate.

## Report shape

Per finding: symptom in one line · root cause with `file:line` · seed **and**
trace · regression-vs-pre-existing (check `git show <base>:<file>`) · suggested
minimal fix · evidence table.

Let the table take the shape the bug actually has. A pure resolver's state space
is a real boolean truth table; a dialog interleaving is not — there the honest
shape is (action sequence / precondition) × (observed / expected). Do not
fabricate booleans.

Then state coverage explicitly: what was fuzzed, LANDED counts, and **what came
back clean under which oracle**. A clean surface is a result only if you name the
watcher. List what you did not reach, and label any "unreachable" conclusion you
reached by code reading rather than by falsifying it in the app.
