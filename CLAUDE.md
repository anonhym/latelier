# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication style

Write every reply to the user in ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, simple tenses, and the controlled STE vocabulary. This applies to normal chat replies, explanations, and summaries — not to code, file contents, commit messages, or generated documents unless the user asks for those in STE too. Technical names, code, file paths, key names, and quoted UI or error text stay in their initial form; STE allows this for Technical Names.

## When to keep going

When a step doesn't need my input, keep going. Put status notes in the
same message as your next action.
Stop and ask only when you can't continue without me, or before anything
destructive: deleting data, force-pushing, or changing anything outside
this repository.

## Check where you are running first

Two environments, and they differ enough that guessing wastes a session. Check once, before planning any work:

```bash
[ "$CLAUDE_CODE_REMOTE" = "true" ] && echo cloud || echo local
```

`CLAUDE_CODE_REMOTE=true` is a cloud container (`claude.ai/code`, ephemeral, Linux). Unset means the maintainer's Mac. Everything below is verified behavior, not caution — in cloud each one fails silently or with a misleading error.

| | Local (Mac) | Cloud (`CLAUDE_CODE_REMOTE=true`) |
|---|---|---|
| GitNexus MCP tools | available | **absent** — use the CLI |
| `.gitnexus/` index | persists | absent on every fresh container |
| `node_modules/` | present | often empty — `npm ci` first (~45s) |
| `npm run test:e2e` | works | needs `xvfb-run` |
| `gh` CLI | works | installed but unauthenticated |
| Third-party plugin marketplaces | trust prompt | pre-seeded by `scripts/cloud-setup.sh` |

**GitNexus MCP is not reachable in cloud.** `.mcp.json` is never read there — the harness supplies its own MCP config and a tool allow-list with no `mcp__gitnexus__*` in it. No amount of repo config changes this. The CLI is fully equivalent and reads the same graph, so the mandatory impact analysis below is still owed; run it this way instead:

```bash
gitnexus impact <symbol>          # blast radius; target is POSITIONAL, there is no --target flag
gitnexus detect-changes           # maps the diff to symbols + execution flows
gitnexus query "<concept>"        # execution flows by concept
gitnexus context <symbol>         # callers, callees, processes
```

`.gitnexus/` is gitignored, so a fresh container has no index and every one of those commands answers `Repository not indexed` until one is built. `scripts/gitnexus-autoindex.mjs` starts a background build at session start; it takes a couple of minutes. To block on it instead, run `npx gitnexus analyze --pdg --index-only` and wait. Confirm with `gitnexus status` before trusting a "not found" result — an unindexed repo and a deleted symbol look identical.

**E2E needs a display in cloud.** `scripts/run-e2e.sh` does not wrap `xvfb`, so `npm run test:e2e` dies at `electron.launch` with `Missing X server or $DISPLAY` and every test fails in about a second. That is the environment, not the diff:

```bash
xvfb-run -a --server-args="-screen 0 1280x1024x24" npm run test:e2e
```

**`gh` is unauthenticated in cloud** (`GH_TOKEN` is invalid), so anything shelling out to it — the issue-tracker skill, `/triage`, `/commit-commands` — fails there. Use the GitHub MCP tools instead.

## Commands

### Native-module ABI — no longer a thing

`better-sqlite3` 13 is an **N-API** addon. Its prebuilt binaries are keyed by platform-arch alone (`prebuilds/darwin-arm64.node`), with no ABI in the name, so one binary serves both the system Node and Electron ABIs. Nothing compiles at install time and there is nothing to flip.

This deleted a whole class of failure that used to dominate this file: the `rebuild:node` / `rebuild:electron` scripts, the `postinstall` rebuild, the ABI flip and `EXIT` trap in `scripts/run-e2e.sh`, and the `check-native-abi.mjs` SessionStart hook are all gone. `npm test`, `npm run test:e2e`, `electron:dev`, and a packaged launch all work off the same install.

**If you see `NODE_MODULE_VERSION` anywhere, do not add a rebuild script.** It means something reintroduced a compile-from-source path — a native dep that isn't N-API, or a `--build-from-source` flag. Fix that instead.

The old advice still applies whenever you check a native module by hand: probe by **opening a database**, not by requiring it. `better-sqlite3` loads its binary inside the `Database` constructor, so `node -e "require('better-sqlite3')"` exits 0 against a broken binary and tells you nothing:

```bash
node -e "const db=require('better-sqlite3')(':memory:'); db.prepare('select 1').get(); db.close();"
```

## Architecture — load-bearing rules

### Process split

All I/O lives in the **main process**. The renderer is a dumb UI and must never import `mongodb`, `better-sqlite3`, `ssh2`, `fs`, `path`, `os`, or anything from `electron/`. Only way renderer talks to the outside world is through `window.atelier` (typed in `shared/ipc.ts`, exposed via `electron/preload.ts`). The legacy name `window.mongolab` was renamed in [X09](./specs/X09-namespace-rename.md).

- `shared/` is types-only — no runtime code — or it drags Node APIs into the renderer bundle.
- `src/api/atelier.ts` wraps the bridge with a helper that throws on `{ ok: false }` so callers `try/catch` and switch on `error.code`.

### Main-process layering

```
routers  (electron/ipc/handlers/*.ts)   thin; just zod-validate + call service
   │
services (electron/services/*, mongo/*Service.ts)  business logic, can orchestrate
   │
repos    (electron/db/repositories/*Repo.ts)       pure SQL (better-sqlite3 is sync)
```

Services are instantiated once in `electron/main.ts` and injected into the router via `registerXxxChannels(router, svc)`. Keep this pattern — no ad-hoc `ipcMain.handle` outside the router.

### IPC envelope & errors

Every channel returns `Promise<Envelope<T>>` = `{ ok: true, data } | { ok: false, error: IpcError }`. Main-side code throws `AppError` subclasses (`ValidationError`, `NotFoundError`, `ConflictError`, `SystemError`, `MongoOpError` in `electron/errors.ts`). The router serializes them to an `IpcError` with a stable `code`. Never leak a raw `Error` across the boundary; never `console.log` — use `electron/log.ts`.

IDs are string UUIDs (`crypto.randomUUID()`), never autoincrement. Timestamps are ISO-8601 `TEXT` in SQLite. Enums are TS string-literal unions mirrored as SQL `TEXT CHECK(...)`.

### SQLite

`better-sqlite3` is sync. Repos use `this.db.prepare(...).run/get/all(...)`. Migrations live in `electron/db/migrations/NNN-name.sql` and are **append-only** — never edit a merged migration; add a new one. `electron/db/sqlite.ts` runs them on startup and enforces `foreign_keys = ON` + WAL mode.

### Renderer state

Workspace tab state (builder, query, view, pagination, expanded rows, column widths) persists through `workspace_tabs.state_json` via the 250ms-debounced `api.tabs.update`. UI state that should survive relaunch goes in `app_state` via `api.prefs.get/set` (e.g., theme, window bounds, panel widths).

`useWorkspaceTabs()` is a hook with local state — **not a context**. There is only one call site in `src/pages/Workspace.tsx`; all children receive the tab state and a `patchCollectionState` callback as props. Don't call the hook from a child or each invocation creates a disconnected copy.

### EJSON on the wire

All Mongo-typed values travel as Extended JSON v2 canonical strings. Main serializes via `bson` in `electron/mongo/ejson.ts` (`relaxed: false`); renderer parses once at the edge via `src/utils/ejson.ts`. Round-tripping preserves `ObjectId`, `Date`, `Long`, `Decimal128`, `RegExp`, `Binary` as their `$oid` / `$date` / etc. sentinels.

## Testing

Four layers with different scopes — `vitest.config.ts` exposes them as projects:

- **unit** (node): pure functions (URI parser, MQL compiler, EJSON, builder reducer).
- **integration** (node, real SQLite temp file + `mongodb-memory-server`): services + repos + handlers. Fixtures in `tests/helpers/db.ts` and `tests/helpers/mongo.ts`.
- **component** (jsdom, `@testing-library/react`): each test provides a mocked `window.atelier` via `tests/helpers/atelierMock.ts`.
- **e2e** (Playwright + Electron driver): full flows. Each test launches with a throwaway `userData` via `ATELIER_USER_DATA_DIR`.

`npm test` runs unit+integration+component. E2E runs separately because it launches the Electron app through Playwright.

### Mutation testing (Stryker)

`npm run test:mutation` runs Stryker Mutator against the modules listed in `stryker.config.json`'s `mutate` array (both `ejson.ts` copies, `uri-parse.ts`, `uri.ts`, `builder.ts`, `filterTree.ts`, `legacyBuilder.ts`, `displayValue.ts`, `shellSyntax.ts`, `envelope.ts`, `log.ts`). The scope is fast-unit-test-only, not strictly pure-only — a candidate file doesn't need every function in it to be side-effect-free. What actually disqualifies a file is slow or non-deterministic coverage: if its relevant logic is only exercised by `mongodb-memory-server`-backed integration tests or component tests, a mutant rerun is too slow, so keep it out until that logic has fast `tests/unit/*.spec.ts` coverage of its own. `log.ts` is the precedent — it mixes pure redaction logic (`redactSecrets`/`walk`) with `fs` side effects (`createLogger`, `pruneOldLogs`), and it qualifies because the whole file's tested surface stays fast and deterministic. `thresholds.break` is 90% on the combined score; the command exits non-zero below it.

When adding a new module with real branching, analyze it against that actual constraint — don't reject it on a purity checkbox — then add it to `mutate` and harden its score toward 90%+ before merging: read the survivor list, then for each survivor either write or tighten a test, or prove the mutant is equivalent — verify with a real check (e.g. a Node probe of actual behavior) before ceding it, never wave off a category without evidence, and never force a genuinely equivalent mutant to "killed" with a meaningless assertion.

### Property-based testing (fast-check)

`tests/unit/*.property.spec.ts` files use `fast-check` to generate randomized inputs against a stated invariant, instead of only hand-picked examples. Use it for functions with a natural invariant: round-trip (`parse(build(x))` recovers `x`, or the documented subset that should survive), fixpoint/idempotence (`f(f(x)) === f(x)`), or "predicate holds for every generated input" (e.g. every secret-named field is always redacted, regardless of type or depth). Mutation testing only strengthens assertions against inputs someone already wrote a test for; fast-check finds untested input shapes nobody thought to write by hand — it found a real `__proto__` document-corruption bug this way, fixed in `ejson.ts`'s `walkRevive`/`relaxLosslessly`.

Conventions: build inputs with real constructors (`bson`'s `ObjectId`/`Long`/`Decimal128`/`Binary`, not hand-built sentinel objects — a boxed `Int32`/`Double` and a raw JS number compare unequal). Verify an equivalence or invariant claim empirically — a quick Node probe — before asserting it in a property, rather than assuming. Never build a test input with a literal `__proto__` key using object-literal syntax; it sets the prototype at construction time instead of creating an own property. Build such inputs from a JSON string or `Object.defineProperty` instead.

## Specs and roadmap

`specs/` is the design source of truth — F (foundation), C (connections), W (workspace), A (aggregation), X (cross-cutting). Before implementing something non-trivial, read the relevant `X##-*.md` — each spec has Purpose / Scope / Types / IPC contract / Behavior / Acceptance criteria / Test cases sections. `specs/PLAN-*.md` files sequence the work.

Known gaps and post-iteration follow-ups are tracked in **GitHub Issues**, with `priority:P0/P1/P2` and `effort:S/M/L` labels. There used to be a `BACKLOG.md` at the repo root holding the same thing; it was retired because a checked-in list and an issue tracker always drift, and the file lost. Older specs still say "de-scoped to `BACKLOG.md`" — read that as "de-scoped and filed as an issue".

## Definition of done

The gates below are this project's bar for merging. They bind every workflow equally — orchestrator skill, plugin loop, subagent, or a human at the terminal. A tool's config may point here; it may never override, relax, or substitute its own list. A gate a workflow cannot run is still owed — someone runs it by hand.

- `npx tsc -b` — typecheck
- `npm run lint`
- `npm test` — the vitest suite
- `npm run test:mutation` — mutation-testing threshold gate over the pure-logic modules in `stryker.config.json`'s `mutate` array; break threshold is 90% combined
- `npm run audit:ipc`, then the `ipc-channel-auditor` agent for the 5-file contract
- `npm run test:e2e`
- Gitar has reviewed the head commit; every finding is fixed, answered, or filed
- Every issue filed out of this change is closed — a discovery ships with the work that found it

Pick the tier once, from the change as a whole; then no gate inside that tier is skipped because a change "probably didn't touch" that area. Docs-only — only Markdown, comments, or `specs/` — owes typecheck, lint, test, and the discovered-issues gate. Everything else, including config, `scripts/`, and CI, owes all eight. Mixed changes are code changes.

The IPC gate is two things. `npm run audit:ipc` is mechanical and narrow: it scans `electron/**` and fails only when a `SECRET_INPUT` tag names a channel outside `scripts/ipc-secret-allowlist.txt`. It cannot see an untagged secret, a tag that lives only in `shared/ipc.ts`, or a half-wired channel. The `ipc-channel-auditor` agent covers that: `shared/ipc.ts`, `electron/preload.ts`, the handler's zod schema + `router.register`, the `registerXxxChannels` call in `electron/main.ts`, the allowlist when the payload carries a secret — plus integration coverage and naming. A green script is not evidence the contract is whole.

The discovered-issues gate governs the defect you notice while implementing something else. It still does not belong in the current diff — file it as its own issue, exactly as before. What changed is what filing buys you: nothing, on its own. The new issue is linked as a blocker of the work that found it (`Blocks #<n>` in its body plus a native dependency edge — commands in `docs/agents/issue-tracker.md`), and the feature stays unfinished while any of its blockers is open. Filing is how a discovery gets scheduled, not how it gets dropped. On a base-branch run the discovery is a ticket on the same base like any other, so what it blocks is the base → `main` PR (`.claude/skills/feature-base-branch/SKILL.md` step 9).

One way out, and it is not the implementer's to take: a discovery that is really a redesign or a feature proposal rather than a defect gets de-scoped by the maintainer, on request. Record the de-scope on the issue in writing, and make sure the work still has an open issue carrying a `priority:` label. Nothing leaves a feature's blocking set silently.

CI runs lint, typecheck, `audit:ipc`, `npm test` **and E2E** on pushes to `main` and on PRs **targeting `main` only**. A PR into a feature base triggers nothing — run every gate locally on those. E2E is a 4-way `--shard` matrix, so it reports as four checks (`Playwright + Electron (1/4)`…`(4/4)`) rather than one. Measured at 7-10 minutes per shard against ~2 locally for the whole suite, because every test pays an Electron launch plus a `mongodb-memory-server` spin-up. The slowest shard is the job, so E2E is ~10 minutes and no longer the slowest thing in CI — the test job is, at the same ~10. `workers: 1` still holds **inside** a shard — the parallelism is across runners, not within one, so no two tests ever share an Electron or a Mongo. Running the suite by hand is unchanged (`npm run test:e2e`); `npm run test:e2e -- --shard=1/4` runs one slice. `npm run test:mutation` is **not** wired into CI — it stays local-only and someone runs it by hand. Code review is Gitar (`gitar-bot`), which reviews every PR by itself; nobody dispatches it. The Claude review workflow (`claude-code-review.yml`) is disabled for now — its file stays, and `gh workflow enable claude-code-review.yml` brings it back. E2E used to be manual too, to conserve free runner minutes — that constraint no longer applies, and `gh workflow run ci.yml --ref <branch>` still dispatches it against a branch that has no PR yet. `scripts/run-e2e.sh` runs under `set -euo pipefail`, so a failing build or `tsc -b` inside it aborts the run instead of letting Playwright pass against a stale bundle. A `NODE_MODULE_VERSION` failure is **not** a rebuild-and-rerun: after the move to an N-API addon there is no rebuild script to run, so it means a compile-from-source path came back — see the native-module section at the top.

Editing this section: some workflows read these bullets to run the gates automatically, so keep the shape — one gate per bullet, command in backticks. Three traps, all silent: a table parses to zero gates; a line opening with `**bold**` parses as an extra gate; and `if`/`when`/`unless` inside a bullet turns that gate into a skippable conditional.

## Shipping checklist

Not gates — obligations that travel with the change. Deliberately its own section rather than a subsection: bullets under the DoD heading get parsed as runnable gates.

- Every PR closes its issue, or is added to the "MongoLab Backlog" project.
- Resolve review threads once the fix is pushed; don't leave them open.
- File scoped-out work and unfixed findings as issues before merge, each linked as a blocker of the change that found it. A PR body is not a tracker, and a filed issue is not a discharge.
- Never amend a pushed commit — new commit, always.
- Never edit a merged migration — new `NNN-*.sql` file, always.

## Conventions worth flagging

- Don't ship `--no-verify`, `--no-gpg-sign`, or `console.log`. Real bugs hide behind those.
- Prefer editing existing files to creating new ones; spec-driven development means most new code has a spec slot it belongs in.
- Migrations beyond 003 go in new files (`004-...sql`), never edit existing ones.
- The `SECRET_INPUT` comment tag on an IPC channel is load-bearing — `npm run audit:ipc` enforces that only allow-listed channels carry the tag. Add to `scripts/ipc-secret-allowlist.txt` before tagging a new one. The check scans `electron/**` only and keys off the tag, so an untagged channel taking a plaintext secret passes silently — tagging is on you, not the script.
- Sort strings with an explicit `.localeCompare()` compare function; a bare `.sort()` on strings is locale-unsafe.
- Never give a plain object a `then` key/method — it becomes an accidental thenable and breaks under `await`/`Promise.resolve()`.
- Avoid regexes with nested quantifiers (`(a+)+`, `(.*)+`); they backtrack superlinearly (ReDoS). Take special care when the regex runs on user- or attacker-controlled input (URIs, user-typed filters).
- A click handler on a non-interactive element (`div`/`span`) needs a native element instead, or a `role` + keyboard handling + `tabIndex` — the a11y bar for every interactive control in the UI.
- CI/shell steps that run `npm install`/`npx` pass `--ignore-scripts` when install-time scripts aren't needed, and pin exact dependency/action versions instead of tags.
- Use `Number.parseInt`/`Number.parseFloat`/`Number.NaN`, not the bare globals.
- Every test carries at least one assertion.
- `UPDATE schema_version SET version = N` in a migration looks like a missing-WHERE bug but isn't — `schema_version` is a singleton one-row table by design. Don't "fix" it by adding a meaningless `WHERE`.

## About the generated GitNexus section below

Everything between the `gitnexus:start` and `gitnexus:end` markers is written by
`npx gitnexus analyze --pdg --skills` and is overwritten on every run. Edit above
the marker, never inside it.

Read its **MUST** and **NEVER** lines as "how to use this tool well", not as
project policy. They are the tool's own generated wording and they do not
survive contact with a contributor who has no index: `.gitnexus/` is gitignored,
so a fresh clone has none, and every query answers `Repository not indexed`
until one is built. GitNexus is also unreachable in cloud sessions, where the
MCP tools are absent entirely.

The project's actual bar is the **Definition of done** above. Impact analysis is
a good way to find the callers a change affects, and on a large refactor it is
the fastest way; grep and the type-checker reach the same answer. Nothing in
this repository merges or fails to merge because of whether an index was
consulted.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **latelier** (50994 symbols, 82082 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; a known upstream GitNexus npm-11 install issue).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user. For unified PDG impact, add `mode: "pdg"` with optional `line: <N>` — it returns statement-level `affectedStatements` over CDG + REACHING_DEF and inter-procedural symbols in `interproceduralByDepth`/`byDepth`; no-layer/degraded PDG results are UNKNOWN-risk notes (`--pdg` layer).
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).
- For control/data dependence, `pdg_query({mode: "controls", target: "fileOrSymbol"})` answers "under what condition does X run?" (CDG, incl. guard clauses) and `pdg_query({mode: "flows", target, variable})` traces "where does variable Y flow?" (REACHING_DEF). `--pdg` layer.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/latelier/context` | Codebase overview, check index freshness |
| `gitnexus://repo/latelier/clusters` | All functional areas |
| `gitnexus://repo/latelier/processes` | All execution flows |
| `gitnexus://repo/latelier/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |
| Work in the Component area (397 symbols) | `.claude/skills/generated/component/SKILL.md` |
| Work in the Workspace area (377 symbols) | `.claude/skills/generated/workspace/SKILL.md` |
| Work in the Mongo area (242 symbols) | `.claude/skills/generated/mongo/SKILL.md` |
| Work in the Pages area (105 symbols) | `.claude/skills/generated/pages/SKILL.md` |
| Work in the Aggregation area (99 symbols) | `.claude/skills/generated/aggregation/SKILL.md` |
| Work in the Electron area (86 symbols) | `.claude/skills/generated/electron/SKILL.md` |
| Work in the Views area (76 symbols) | `.claude/skills/generated/views/SKILL.md` |
| Work in the Connections area (71 symbols) | `.claude/skills/generated/connections/SKILL.md` |
| Work in the Services area (68 symbols) | `.claude/skills/generated/services/SKILL.md` |
| Work in the Integration area (55 symbols) | `.claude/skills/generated/integration/SKILL.md` |
| Work in the FieldSuggestions area (45 symbols) | `.claude/skills/generated/fieldsuggestions/SKILL.md` |
| Work in the References area (35 symbols) | `.claude/skills/generated/references/SKILL.md` |
| Work in the Commands area (23 symbols) | `.claude/skills/generated/commands/SKILL.md` |
| Work in the State area (19 symbols) | `.claude/skills/generated/state/SKILL.md` |
| Work in the ScriptEditor area (16 symbols) | `.claude/skills/generated/scripteditor/SKILL.md` |
| Work in the Unit area (15 symbols) | `.claude/skills/generated/unit/SKILL.md` |
| Work in the Repositories area (14 symbols) | `.claude/skills/generated/repositories/SKILL.md` |
| Work in the Hints area (14 symbols) | `.claude/skills/generated/hints/SKILL.md` |
| Work in the Troubleshooting area (8 symbols) | `.claude/skills/generated/troubleshooting/SKILL.md` |
| Work in the Ipc area (8 symbols) | `.claude/skills/generated/ipc/SKILL.md` |

<!-- gitnexus:end -->

## Local enforcement hooks

One hook in `.claude/settings.json` enforces the rules above at edit time rather than at review time:

- `scripts/check-renderer-purity.mjs` — PreToolUse on Edit/Write/MultiEdit. Blocks an edit that would introduce a forbidden import into `src/**` (`electron`, `mongodb`, `better-sqlite3`, `ssh2`, and Node built-ins like `fs`/`path`/`os`). Exits 2 to refuse; allowed in `electron/**` and `scripts/**`.

`check-native-abi.mjs` used to sit alongside it as a SessionStart probe; it was deleted when the native module moved to an N-API addon.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (anonhym/latelier), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
