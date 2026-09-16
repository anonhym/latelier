# X18 — Deepening seams: Shell Syntax fields and the Read-Only handle

## Purpose

Two cross-cutting rules in this codebase are applied by hand at every call site
rather than carried by a seam. Both work today. Both are one forgotten line away
from failing silently, and both have already failed that way at least once.

1. **Shell Syntax repair.** "Rewrite to Canonical EJSON on blur, and again on the
   action, because a click can land before a blur ever fires" is retyped at 17
   sites across 8 files. A ninth surface can simply not do it.
2. **Read-Only Connection refusal.** `MongoPool.assertWritable(connectionId)` is
   called by hand at the top of 18 write-service methods. Nothing forces a *new*
   write method to get one — the codebase says so itself, in the header comment of
   `tests/unit/read-only-channel-classification.spec.ts`.

Neither is a rewrite. In both cases the logic is already correct and already deep;
what is missing is the seam that makes applying it the only path rather than a
remembered step.

This spec does not change any user-visible behaviour. Every acceptance criterion
below is a statement about structure or about a test, with one exception —
§5, a live defect found while gathering the evidence.

## Scope

### In

- A React seam for text surfaces that accept Shell Syntax (§3).
- A guarded-handle surface on `MongoPool`, replacing the hand-placed
  `assertWritable` calls (§4), plus the ADR that amends
  [ADR 0005](../docs/adr/0005-read-only-connection-enforcement.md).
- The `ScriptService` stale-`readOnly` defect (§5).
- Moving the `maxTimeMS` bound onto the same handle (§6).
- Moving raw-driver-error classification onto the same handle (§7).

### Out

- Any change to `repairToCanonicalEjson`'s transform rules. ADR 0004's
  text-splice discipline is untouched; the repair logic stays in
  `src/utils/shellSyntax.ts` so it stays inside the Stryker `mutate` array.
- Extending `makeDbProxy` to the shell pane. ADR 0005 rejected that on evidence
  (the REPL context has `require`/`process`) and this spec reaffirms it.
- A router-level `{ write: true }` tag. Also rejected by ADR 0005, also reaffirmed
  — it cannot express `agg:run`'s per-pipeline conditionality.
- Wrapping read handles in a deny-by-default proxy. See §4's honest limitation.

## 1. Vocabulary

No new domain terms. This spec uses **Shell Syntax**, **Canonical EJSON**,
**Filter Bar**, **Read-Only Connection**, **Open Connection** and **Operation**
exactly as `CONTEXT.md` defines them.

One architecture term is used throughout, from `/codebase-design`: a **seam** is
the single place a rule is applied, such that no caller can route around it.

## 2. Characterization first

Every ticket in §3–§7 is behaviour-preserving. That claim is only worth anything
if the current behaviour is pinned *before* the refactor, by tests written against
the surface that survives it.

**Hard constraint on every characterization test.** It must drive the surface that
survives the refactor, not the function being moved.

- For §3: render the component, type Shell Syntax, fire the real event
  (blur / Cmd+Enter / Apply / Save / Insert), assert the Canonical EJSON that lands
  in the box or the refusal text that appears. A test calling `repairOnCommit`
  directly characterizes a function that is already covered, and dies with the
  refactor.
- For §4: build a Read-Only Connection, call the service method, assert the refusal
  *and its error identity*. A test reaching for `pool.assertWritable` dies with the
  rename and pins nothing.

A characterization test must pass on the unrefactored tree. That is checkable: the
test commit lands green before any production file is touched.

### 2.1 §4 is already characterized — audited, not assumed

All 18 guard sites are pinned today, each by a named test that builds a Read-Only
Connection and asserts the refusal. Two different contracts are in use, and both
are worth keeping:

- The twelve service-layer sites (`DocumentService`, `CollectionAdminService`,
  `IndexService`, `UserService`, `AggregationService`) assert the wire-crossing
  `IpcError.code === 'READ_ONLY'` — which proves the code survives serialization.
- `ShellService`, `ScriptService` and `dbProxy` assert
  `toBeInstanceOf(ReadOnlyConnectionError)` — the class, in-process.

**So §4 owes no new characterization tests.** What it owes instead is listed in
§4.3: existing tests that must *change* with the rename, including five that the
typechecker cannot protect.

### 2.2 §3's coverage hole — corrected

An earlier revision of this section claimed nine unpinned call sites, "verified
directly". That was wrong, and the way it was wrong is worth recording.

The check was a **filename** filter — `edit-drawer-*`, `insert-drawer`,
`query-expand` — which structurally cannot see a spec named for the *surface class*
rather than the component. `tests/component/write-surface-shell-syntax.spec.tsx`
(13 tests, 5 blur events, landed in `0b0cedb`) is exactly that file, and it holds
most of the coverage the section said was missing. A content search
(`grep -rl "Shell Syntax" tests/`) finds it immediately.

**Already pinned, in that file:**

| Site | Test |
|---|---|
| `EditDrawer.tsx:99` | "opens Save for a buffer that is only Shell Syntax" (`:67`) |
| `EditDrawer.tsx:102` | "leaves text it cannot read exactly as typed, and names the reason" (`:102`) |
| `InsertDrawer.tsx:77` | "rewrites Shell Syntax in the box, on blur" (`:166`) |
| `InsertDrawer.tsx:69`, `:77` | "inserts Canonical EJSON even when Insert is pressed before any blur" (`:177`) |

**Genuinely unpinned, and what ticket 1 owes:**

- `EditDrawer.tsx:157` — the blur-**then**-Save *sequence*. Both halves are pinned
  separately (`:56`, `:78`); the ordering between them is not.
- `InsertDrawer.tsx:71` — the shape is pinned at `:210` with a bare-word fixture, but
  the regex-flag branch in `regexText` is not reached by any test.
- `QueryExpandModal.tsx:19,38,39` — no test file exists for this component.
- The blank-filter message branch (see below).

`QueryBar` (filter, projection, sort), `useQueryRunner`, `StageAccordion` (blur and
Format), `AggregationTab` and `pipeline.ts` were correctly assessed as solidly
pinned.

### 2.3 A second premise error, in the blank-filter case

The same revision asserted that a blank filter renders `filterProblem`'s *shape*
message. It does not. `refusalMessage('', …)` returns `null` on its blank guard, then
`filterProblem('')` takes the **parse** branch, because `isValidEjson('')` is false:

```
Can't parse this filter. Expected EJSON like { "status": "active" }.
```

The shape message at `builder.ts:246` is unreachable for blank input.

Ticket 1 pins what the code does. The copy is poor for an empty box — "can't parse"
describes a typo, not an empty field — but changing it is a behaviour change and does
not belong in a characterization ticket. Filed separately.

## 3. The Shell Syntax field seam

### Current shape

`src/utils/shellSyntax.ts` is already a deep module — three exports over an acorn
span-splicing implementation. The friction is above it. Two distinct patterns are
tangled across the 17 call sites:

**Pattern A — a text surface a person edits.** Holds a draft, repairs it on blur,
shows a refusal, clears that refusal on the next keystroke, and repairs again at
the action. Seven surfaces: the Filter Bar, projection and sort in `QueryBar`,
`EditDrawer`, `InsertDrawer`, `QueryExpandModal`, `StageAccordion`.

Each carries its own `useState` for the refusal, its own clear-on-change, and its
own ordering of "transform refusal first, then the document rule". The ordering is
load-bearing and stated only in a comment (`QueryBar.tsx:187-188`).

**Pattern B — repair before send.** No draft, no refusal, no lifecycle: take
whatever is in state, repair it, use the returned text right now. `useQueryRunner`
(three fields, accumulated into one patch), `AggregationTab`, and
`QueryExpandModal`'s one-time initial normalise.

### A correction to the review's count

The architecture review listed "17 call sites" and QueryBar.tsx:229 as "filter run".
Both are slightly off, and the difference matters for what the seam is worth.

`QueryBar.tsx:229` is inside `runQueryExplain` — the **Explain** path, not Run. The
Cmd+Enter run trigger (`handleKeyDown`, `:260`) reuses the *same* `repairQueryRaw()`
closure already counted at `:186`. So there are **16 distinct call expressions**, and
QueryBar's `queryRaw` repair serves three triggers through one of them.

Further, by the code's own comment (`QueryBar.tsx:207-214`), the repair at `:229`
**cannot currently fire**: `canExplain === canRun`, which already refuses everything
the transform would repair. It is there so Explain does not *depend* on that staying
true. No test exercises a repair firing there, and none can.

### Decision

**Pattern A gets the seam. Pattern B does not.**

Pattern B is already served by `repairOnCommit` at its natural size — a single
call whose result is used immediately. There is no lifecycle to own and no state
to hold, so a hook there would be an interface wrapped around one function call.
`useQueryRunner`'s three calls are one coherent block with a documented reason for
being three (`patchCollectionState` is not a functional updater, so the three
repairs accumulate into one patch). Splitting that block would make it worse.

`Aggregation/pipeline.ts` is not React and keeps calling the pure functions
directly. This is correct and stays.

### The asymmetries the seam must absorb

A "value + onCommit" hook is too narrow. Four Pattern A surfaces do something the
naive shape cannot express, and a seam with four documented exceptions is not a
seam:

| Surface | What it needs beyond value + commit |
|---|---|
| `QueryBar` projection (`:317`) | Repair, then classify with `parseProjection`, then commit to **one of two different targets** — `builder.projection` (array) or `builder.projectionRaw` (string) |
| `StageAccordion` Format (`:579`) | The raw outcome with **no** auto-commit — it commits the pretty-printed text, not the repaired text |
| `EditDrawer` (`:99`) and `InsertDrawer` (`:69`) | The outcome **live, every render**, off the uncommitted buffer — it gates the Save/Insert button — *and* a separate discrete commit at blur |
| `QueryBar` sort (`:359`) | The refusal **alone**, not combined; the shape check is a separate memo and the two are OR'd in JSX at `:774` |

There is also a real UX asymmetry worth preserving deliberately rather than
accidentally: `EditDrawer` enables Save on repairable Shell Syntax **before** any
blur, because its outcome is derived per render. `QueryBar` keeps Run gated until a
commit. Ticket 1 pins both; the seam must not quietly align them.

### Interface

`src/pages/Workspace/useShellSyntaxField.ts` — a hook owning the draft lifecycle.
The repair itself stays in `src/utils/shellSyntax.ts`, so that file stays inside
Stryker's `mutate` array with its score intact.

```ts
export function useShellSyntaxField(opts: {
  value: string;
  /** Where a repair is written back. Omit for a surface that commits
   *  something other than the repaired text (Format). */
  commit?: (repaired: string) => void;
  /** A second rule applied to already-repaired text, after the transform's own
   *  refusal and never collapsed into the same sentence — e.g. `filterProblem`.
   *  Omit where the caller ORs the two itself at render (sort). */
  thenCheck?: (repaired: string) => string | null;
}): {
  /** Live, recomputed each render from `value`. Serves the drawers' Save gate. */
  outcome: RepairOutcome;
  /** The refusal to render, or null. Set at the commit point, never derived per
   *  keystroke — `Notice` is a role="alert" and a derived one would announce
   *  half-typed input on every character. Cleared by `onChange`. */
  refusal: string | null;
  onChange: (next: string) => void;
  /** Repair, commit, set the refusal. */
  onBlur: () => void;
  /** Repair + commit + hand back the text to act on **this tick** — a state
   *  patch is async and a click can land before a blur ever fires. */
  commitNow: () => { text: string; outcome: RepairOutcome };
  /** Repair and set the refusal, but commit nothing. For a surface that decides
   *  its own commit target (projection) or commits different text (Format). */
  repairNow: () => { text: string; outcome: RepairOutcome };
};
```

`repairNow` plus a live `outcome` is what turns the four exceptions above into
ordinary uses. Every Pattern A surface then routes its repair through the hook and
inherits the refusal lifecycle, even where it owns its own commit.

### Honest scope

This is a smaller win than the review claimed. It is not "17 calls become 8". It is
**16 distinct call expressions across 7 surfaces becoming 7 hook uses**, with the
real prize being the refusal state machine — currently three separate `useState`s in
`QueryBar` alone, each with its own clear-on-change — and the fact that a new text
surface gets the blur-and-again-on-action rule by default instead of by memory.

`QueryExpandModal` having no test file at all is a second, independent reason to do
the work: ticket 1 gives it one.

### Acceptance criteria

- [ ] All seven Pattern A surfaces obtain their outcome and refusal from the hook,
      and hold no refusal `useState` of their own.
- [ ] No Pattern A surface calls `repairOnCommit`, `repairToCanonicalEjson` or
      `refusalMessage` directly.
- [ ] Pattern B call sites are unchanged, and `Aggregation/pipeline.ts` still calls
      the pure functions directly — it is not React.
- [ ] `src/utils/shellSyntax.ts` is byte-unchanged and its Stryker score does not
      drop.
- [ ] Every characterization test from ticket 1 passes **without modification**.
- [ ] The empty-string suppression still holds where it is load-bearing — a blank
      sort shows no refusal. (Audited: the sort blur is the only site that genuinely
      depends on it. `pipeline.ts` guards blank earlier, so the suppression is dead
      code on that path.)
- [ ] `EditDrawer`'s pre-blur Save gate and `QueryBar`'s post-commit Run gate both
      behave exactly as ticket 1 pinned them.

## 4. The Read-Only guarded handle

### Current shape

A service asks the pool for a raw handle — `getDb(id, dbName)` (20 call sites) or
`getClient(id)` (11) — and separately remembers to call `assertWritable(id)` (18).
The two are unrelated in the type system. The pool's own comment admits what the
interface is:

```
/** Throws ReadOnlyConnectionError if the connection is read-only. Call at
 *  the top of every write-service method, before any Mongo call. … */
```

An interface written as an instruction in a comment is the definition of a missing
seam. Two shipped defects were exactly this miss: `923c90a` (the shell pane
re-checked only at session start) and `53c4469` / #451 (a `db.collection()` path
around the proxy).

### Decision

`MongoPool` stops handing out neutral handles.

```ts
readDb(id: string, dbName?: string): Promise<Db>;
readClient(id: string): Promise<MongoClient>;

/** Refuses a read-only connection synchronously; connects nothing. */
write(id: string): WriteGrant;

interface WriteGrant {
  db(dbName?: string): Promise<Db>;
  client(): Promise<MongoClient>;
}
```

A write is two steps, deliberately. Refusal and connection sit at different
points in a write method and must stay there — refuse at the top, validate
locally in the middle, connect at the bottom. A single awaited `writeDb(...)`
cannot occupy all three positions, and both placements break something
observable: at the top, local validation starts failing as connection errors
against an unreachable server; at the bottom, a malformed payload on a
read-only connection reports `VALIDATION` where it used to report `READ_ONLY`.

`getDb` and `getClient` leave the service-facing surface. The pool keeps a private
handle for its own operations (`ping`, `serverInfo`, `probe`), which are not
Connection writes.

`assertWritable` stays, but as one internal call inside `write()`
rather than 18 external ones. `AggregationService` still decides for itself whether
its pipeline writes, then asks for the matching handle — the per-pipeline
conditionality ADR 0005 protects is preserved exactly.

### Honest limitation

This is **not** unbypassable. A write method could call `readDb` and write through
the returned `Db`; the driver would not stop it. What changes is the failure mode:
a forgotten `assertWritable` is invisible, and asking for a read handle in a method
named `insertOne` is visible in the diff.

Making it truly unbypassable means wrapping every read handle in a
deny-by-default proxy like `makeDbProxy`. That is out of scope: it puts a proxy in
every read path in the app for a defect class that review already catches once the
name is wrong, and `dbProxy.ts` has its own history of paths around it.

Do not write "unbypassable" into the ADR.

### 4.2 The four handles that back both a read and a write

Most call sites classify cleanly. Four do not, and each needs a stated answer
rather than a guess:

| Site | Shape | Answer |
|---|---|---|
| `CollectionAdminService.create` (`:30`) | `db.listCollections()` as a pre-check, then `db.createCollection()`, through one handle | A write grant taken at the top; reading through a write handle is not a violation. The refusal fires before the pre-check, exactly where `assertWritable` stood. |
| `AggregationService.getCollection` (`:341-346`) | One private helper backing `run()`'s write path, `run()`'s read path, `previewUpToStage()` and `explain()` | The helper takes the caller's grant — or `null` for a read — as a parameter. `run()` has decided by `:68` whether the pipeline writes; it passes that down. It must take the grant *before* the target guards and connect *after* `registerCancel`, or a cancel arriving mid-connect is discarded. This is the ADR 0005 conditionality, preserved — not reintroduced. |
| `ScriptService.run` (`:115`) | Hands a raw client to `makeDbProxy`; reads and writes are split by the proxy allowlist, not by the handle | `readClient`. The handle cannot express what a sandboxed script will do; the proxy is the enforcement point, per ADR 0005's second bullet, and §5 makes it live. |
| `ShellService.start` (`:70`) | Hands a raw client to `makeDbProxy` with no `readOnly` in ctx at all | `readClient`, and the wholesale session refusal at `:60` stays exactly as it is. ADR 0005's third bullet: a proxy guard here would be decorative because the REPL has `require`. |

`ReferenceRulesService` and `MetaService` are pure reads throughout — audited, not
assumed.

### 4.3 Tests that change, and the five the typechecker cannot protect

No new characterization is owed (§2.1), but the rename is not free:

- **Five hand-rolled fake pools are cast through `unknown`** —
  `tests/integration/script-service.spec.ts:132,150`,
  `shell-service.spec.ts:52,70`, and `mongo-handlers.spec.ts:82`. Because the cast
  launders the type, renaming the real `MongoPool` methods **passes `tsc -b`** and
  fails only at test runtime with "not a function". The typecheck gate will not
  catch this. Whoever does the rename updates these by hand and confirms by running
  the suite, not by trusting the compiler.
- **The `vi.spyOn(pool, 'getDb')` sites in `document-service.spec.ts`**
  (`:538, :546, :553, :566, :590, :1049`) change meaning, not just name. Today
  `expect(getDb).not.toHaveBeenCalled()` proves validation ran before any handle was
  acquired. After the split the spy wraps the grant's handle for the write methods and
  `readDb` for `confirmDeleteMany`, and it now also asserts which handle was asked
  for. That is a stronger assertion — say so in the PR rather than letting it look
  like a rename.
- **Roughly thirty mechanical sites** across `document-service.spec.ts`,
  `index-service.spec.ts:262` and `aggregation-service.spec.ts:53,420,426,443` seed
  or verify data through the real pool. Mostly `pool.write(id).client()`. No
  behavioural change.

### ADR

ADR 0005 is titled "three enforcement points, not one" and its Decision has three
bullets. This spec changes **the shape of the first bullet only**.

**Update ADR 0005 in place.** Do not add a new ADR that amends it from the outside.
A reader — including a reader of this repository once it is public — should open one
file and find the decision as it stands, not reconcile a chain of documents to work
out which parts still hold. The ADR set is the current architecture, not a ledger of
how it got here.

The updated 0005 must:

- Keep bullets two and three intact — the script pane's `makeDbProxy` read
  allowlist, and the shell pane's outright refusal on the evidence that its REPL
  context has `require`/`process`.
- Rewrite bullet one around the guarded handle, and say why the handle sits at the
  service layer: that is exactly where 0005 already said write semantics are known,
  so `agg:run`'s conditionality stays at the caller.
- Keep both rejected alternatives, and add two more to the same list: the
  hand-placed call this replaces (rejected on the evidence that it shipped the
  defect twice), and the genuinely-unbypassable version (rejected on cost).
- Record the honest limitation above as a Consequence, along with the
  `as unknown as MongoPool` typecheck trap and the class-not-message assertion gap,
  both of which will catch whoever changes this surface next.

The Context section carries the *why* — a rule a comment has to state is a rule that
can be omitted — so nothing is lost by there being no separate amendment document.

### Acceptance criteria

- [ ] No `assertWritable` call outside `MongoPool`.
- [ ] No `getDb`/`getClient` call outside `MongoPool`.
- [ ] Refusal still outranks local validation, and local validation still precedes any connection attempt. Both pinned by tests — neither was before.
- [ ] `agg:run` registers cancellation before it connects.
- [ ] Every one of the 18 previously-guarded methods obtains a write handle.
- [ ] A read-only refusal still throws `ReadOnlyConnectionError` and still crosses
      IPC as the same `IpcError.code` as before.
- [ ] `tests/unit/read-only-channel-classification.spec.ts` still passes. It is
      **not** retired in this ticket — a channel can still be classified wrong, and
      the handle does not answer that. Retiring it is a separate decision.
- [ ] Every characterization test from §2 passes without modification.

## 5. Defect — a script keeps its write surface after the Connection flips

**This is not a refactor. It is a live defect found while gathering evidence for
§4, and it ships on this base as its own ticket.**

`electron/services/ScriptService.ts:128-134` builds the proxy context:

```ts
const dbCtx = {
  currentDb: input.dbName ?? 'test',
  client,
  signal: ctrl.signal,
  readOnly: this.pool.isReadOnly(input.connectionId),
};
```

`readOnly` is read once, at construction, and has no second assignment in the file.
Its sibling `currentDb` on the same object *is* mutated later, by `use()`. So a
script already running when its Connection is switched to Read-Only keeps its write
surface for the rest of the run, bounded only by the script timeout.

This is structurally the same defect `923c90a` fixed in `ShellService.write()`.
The script pane never got the equivalent re-check.

### Fix

The proxy traps in `dbProxy.ts` already read `ctx.readOnly` on **every** property
access (`:178`, `:196`, `:202`) — the staleness is entirely in the value, not in
when it is consulted. So the fix is to make the value live:

```ts
// dbProxy.ts
export interface DbProxyCtx {
  …
  isReadOnly?: () => boolean;   // was: readOnly?: boolean
}
```

A function rather than a getter, because `getSiblingDB` builds the sibling proxy
with `makeDbProxy({ ...ctx, currentDb: name })` and a spread evaluates a getter
once, snapshotting the very value this fix exists to keep live. A function
reference survives the spread.

### Acceptance criteria

- [ ] A test flips a Connection to Read-Only *during* a running script and asserts
      the next write through `db` is refused.
- [ ] The same test shape covers `getSiblingDB` — a sibling proxy obtained before
      the flip also refuses after it.
- [ ] `ShellService`'s existing behaviour is unchanged.

## 6. The `maxTimeMS` bound on the source, not the handle

Twenty applications of `maxTimeMS` across the services, from six unshared timeout
constants. Every `DocumentService` write, all of `UserService` and all of
`CollectionAdminService` carry none at all.

This section originally said the handle was the place this belongs — that once §4
landed, `readDb` and the grant would return a `Db` that already carries the bound.
That premise was probed against a real server (mongodb 7.5.0) and is false, on three
counts:

- `client.db(name, { timeoutMS })` works, but a timeout under it throws
  `MongoOperationTimeoutError` with `codeName: undefined` and `code: undefined` —
  not `MongoServerError` / `codeName: 'MaxTimeMSExpired'` / `code: 50`, which is what
  per-operation `maxTimeMS` throws.
- `electron/mongo/errors.ts`'s `classifyMongoOpError` keys TIMEOUT off
  `codeName === 'MaxTimeMSExpired'`. Moving to Db-level `timeoutMS` would silently
  regress every timeout to `MONGO_ERROR`.
- A `Db` built with `timeoutMS` **overrides** an explicit per-call `maxTimeMS`
  rather than deferring to it — which makes the acceptance criterion below
  ("overridable per call") unsatisfiable by construction.

The bound stays per-operation `maxTimeMS`, unchanged in mechanism. What moves is the
*source* of the number: one shared module (`electron/mongo/timeouts.ts`) exporting
named constants by operation class, in place of the six unshared constants and three
bare literals. The acceptance criteria below are unaffected by this correction — all
three were, and remain, satisfiable against the per-operation mechanism.

Deliberately a separate ticket regardless of mechanism. It is a behaviour change —
operations that are currently unbounded become bounded — and bundling it with §4
would make a behaviour-preserving refactor indistinguishable from a behaviour change
in the same diff.

### Acceptance criteria

- [ ] One shared source for the bound; the six ad-hoc constants are gone.
- [ ] Each of the previously-unbounded methods is bounded, and a test asserts it.
- [ ] The bound is overridable per call for the operations that legitimately need
      longer, and each override says why.

## 7. Error classification on the handle

Twenty-three raw-driver-error classifications across four separate classifiers.
Only the last step, `AppError` → `IpcError`, has a real seam
(`electron/ipc/router.ts:123`).

Once §4 lands, the handle can classify on the way out, so a raw driver error cannot
reach the router unclassified.

Also deliberately separate: it changes which error code a caller sees in the cases
that are currently misclassified, and those need to be enumerated before they are
changed.

### The seam is the router, not the handle — corrected in implementation

The premise above did not survive contact with §4 as built. `pool.readDb()` and
`pool.write()` return a **raw driver `Db`**, not a classifying wrapper: §4's handle
carries the read-only grant, not an error seam. Nothing in §4 put classification on
the way out, so "a raw driver error cannot reach the router unclassified" was never
true, and three `QueryService` methods proved it — `count`, `findOne` and `explain`
had no classifier at all, so a `MaxTimeMSExpired` reached `toIpcError` as a bare
`Error` and left it `INTERNAL` rather than `TIMEOUT`.

Wrapping every returned `Db` to classify on the way out was considered and rejected
on the same evidence §4 itself produced: a proxy over a driver object graph is
deny-by-enumeration against a surface the driver is free to change, and six separate
escapes of that shape were found and closed during this epic — each by reviewing the
fix for the last. Adding a second such proxy, for error handling rather than for
safety, buys a weaker guarantee at that cost.

The router is the one place every channel already passes through, and it cannot be
bypassed by forgetting a call. So classification sits there, as a backstop behind
the per-service catches rather than instead of them, and deliberately narrow:
`classifyMongoOpError` ends in `MONGO_ERROR`, so classifying indiscriminately would
relabel a `TypeError` from our own code as a database problem. Only driver errors
are touched.

Two consequences worth recording, both found by review rather than by design:

- The backstop must be **non-throwing**. `instanceof` runs a Proxy's
  `getPrototypeOf` trap and reading `name` runs a getter, so classifying in front of
  `toIpcError` — which is itself `try`-wrapped for this reason — put that read
  outside the envelope's guard and made a hostile thrown value reject the handler
  instead of returning `{ ok: false, error }`.
- A backstop behind a working per-service catch is **invisible to a test that goes
  through a service**. Removing it left the whole suite green. It needs a test that
  surfaces a raw driver error at a registered handler with no service in the path.

### Acceptance criteria

- [x] One classifier.
- [x] A test asserts that a raw driver error reaching the router unclassified leaves
      it as an `AppError` with the right code, with no service in the path — and
      fails if the backstop is removed.
- [x] Every code change relative to today is listed in the PR body.

## 8. Ticket order

Stacked, oldest first.

| # | Ticket | Depends on |
|---|---|---|
| 1 | Characterization tests for §3's nine unpinned sites | — |
| 2 | §4 Read-Only guarded handle + ADR 0005 update | — |
| 3 | §5 `ScriptService` stale `readOnly` | 2 |
| 4 | §3 Shell Syntax field seam | 1 |
| 5 | §6 `maxTimeMS` on the handle | 2 |
| 6 | §7 Error classification on the handle | 2 |

The order changed once the audit came back. §4 was expected to need a
characterization ticket and does not — all 18 guards are already pinned — so it
moves ahead of §3, whose nine-site coverage hole is the only real characterization
debt here. Ticket 2 therefore starts immediately, in parallel with ticket 1.

Ticket 3 is a live defect and is placed directly behind the handle it rides on
rather than at the end.

## 9. Test cases

### Ticket 1 — the genuinely unpinned Shell Syntax sites

All component-layer. Each must pass on the unrefactored tree. Six new tests plus one
strengthened assertion — not the ten an earlier revision listed; see §2.2.

| # | Case | Pins |
|---|---|---|
| T1 | `EditDrawer`: type `{age: 1}`, blur → `{"age": 1}` in the textarea, **then** Save writes that repaired text via `api.doc.replace` | `:157` — the sequence; the halves are pinned separately already |
| T6 | `InsertDrawer`: an unsupported regex flag shows the transform's reason, not the generic `'Invalid EJSON'` fallback | `:71` — the `regexText` branch, unreached today |
| T7 | `QueryExpandModal`: opens seeded with a pretty-printed repaired rendering of a Shell Syntax `queryRaw` | `:19` |
| T8 | `QueryExpandModal`: Apply repairs and calls `onApply` with Canonical EJSON | `:38` |
| T9 | `QueryExpandModal`: unrepairable text shows the reason inline and does **not** call `onApply` | `:39` |
| T10 | A blank filter renders `Can't parse this filter. …` — the parse branch, not the shape branch | the empty-string suppression's one untested path (§2.3) |
| T2′ | Strengthen the existing "opens Save for a buffer that is only Shell Syntax" (`write-surface-shell-syntax.spec.tsx:67`): Save enabled **and** the textarea still holding un-repaired text | `:99` derives per render — the current assertion alone does not pin that |

T7–T9 create the first test file `QueryExpandModal` has ever had.

**T3, T4 and T5 from the earlier list are deliberately not written.** They already
exist verbatim in `write-surface-shell-syntax.spec.tsx`. Their coverage is instead
*demonstrated* — ticket 1's mutation check breaks `InsertDrawer.tsx:77` and
`EditDrawer.tsx:99`/`:157` and shows those existing tests going red. A duplicate
test proves less than a red one.

Component count: 1185 → 1191.

### Ticket 3 — the `ScriptService` defect

| # | Case | Layer |
|---|---|---|
| T11 | A script running when its Connection flips to Read-Only has its **next** write refused | integration |
| T12 | A sibling proxy obtained from `getSiblingDB` *before* the flip also refuses after it | integration |

T11 needs a fixture that can express the bug. The current `fakePool`
(`script-service.spec.ts:126-133`) hardcodes `isReadOnly: () => false` and the
real-Mongo `setup()` at `:765` builds static rows — neither can flip. Mirror
`shell-service.spec.ts:60-72`'s `mutableFakePool`, which exists for exactly this.

### Tickets 2, 5, 6 — no new characterization

Covered by the existing suite (§2.1). What these tickets owe is the changed tests
in §4.3, plus:

| # | Case | Layer |
|---|---|---|
| T13 | Read methods still succeed on a Read-Only Connection | integration |
| T14 | `agg:run` refuses a `$out` pipeline and allows a read pipeline on the *same* Read-Only Connection | integration |
| T15 | Each previously-unbounded method is now bounded by `maxTimeMS` (ticket 5) | integration |
| T16 | A raw driver error surfacing through a handle reaches the router already an `AppError` (ticket 6) | integration |
