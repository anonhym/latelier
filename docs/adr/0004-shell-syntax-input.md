# Query surfaces accept Shell Syntax; stored query text stays Canonical EJSON

## Status

accepted

## Context

The app does not agree with itself about its own query language, and it does not agree with
MongoDB's ecosystem either.

Every read-query input validates with strict `JSON.parse`. The Filter Bar rejects
`{age: {$gt: 60}}` (`filterTree.ts:280`). The aggregation validator rejects the same shape via
`isValidEjson` (`pipeline.ts:229`). Meanwhile the app's *own* `$group` stage template is written
`{ _id: "$field", count: { $sum: 1 } }` — unquoted keys — so Run and Explain are disabled from the
moment the app writes its own starter code. The stage picker's built-in help teaches the syntax the
validator rejects. And the built-in shell accepts all of it without complaint, because it evaluates
real JavaScript in a `vm` sandbox (`ScriptService.ts`).

So three surfaces disagree: two reject relaxed input, one accepts it, and the templates and help
text are written in the rejected dialect. Every tutorial, every mongosh session, every Compass
example, and every Stack Overflow answer is also written in the rejected dialect.

A note on vocabulary, because one word was doing two jobs: the codebase already uses **relaxed** to
mean *EJSON relaxed mode* (`EJSON.stringify(…, { relaxed: false })`). The syntax users type is a
different concept. `CONTEXT.md` now names it **Shell Syntax** and reserves *relaxed* for the BSON
meaning.

## Decision

**Read-query inputs accept Shell Syntax. Stored query text is always Canonical EJSON.**

- **Lenient input, on read surfaces first, write surfaces second.** Filter Bar, Sort, Projection and
  aggregation stage bodies took it in X14. `EditDrawer` and `InsertDrawer` were held back on the
  grounds that they write data, and a misread value there corrupts a document rather than returning
  wrong rows. That deferral was later lifted, extending it to them; see the reversal below for what changed and what did not.

- **Tier 2 syntax coverage, plus regex literals** — unquoted keys, single-quoted strings, trailing
  commas, plus the mongosh value constructors `ObjectId(…)`, `ISODate(…)`, `new Date(…)`,
  `NumberLong(…)`, `NumberDecimal(…)`. Tier 2 rather than Tier 1 because the single most common
  paste of all is a query on `_id`, and that paste always contains `ObjectId(...)`. Regex literals
  (`/^acme/i` → `{"$regularExpression":{"pattern":"^acme","options":"i"}}`) were added once
  it was clear they need no evaluator — see the Tier 3 entry below. A flag MongoDB has no
  equivalent for (`g`, `y`) is refused by name rather than dropped, because a dropped flag changes
  what the query means and leaves it looking correct.

- **A text transform, never a value evaluation.** Parse with `acorn`, walk the AST, emit Canonical
  EJSON *text*. Each constructor maps to its EJSON sentinel by **copying the argument text**:
  `ObjectId("abc")` → `{"$oid":"abc"}`, `NumberLong("…")` → `{"$numberLong":"…"}`. Nothing is ever
  turned into a JavaScript value on the way through. Sole exception: `new Date()` with no arguments
  must resolve to a real timestamp — the rewrite makes that timestamp visible in the input.

- **Conversion happens at the input edge, on blur and on Run.** Shell Syntax is normalized to
  Canonical EJSON *in the box the user typed it in*. Stored state (`queryRaw`, `stage.body`,
  `workspace_tabs.state_json`, saved queries and pipelines) therefore holds Canonical EJSON and
  nothing else. `currentFilterJson`, the delete-all path, the IPC contract, and the whole main
  process are unchanged by this work.

- **The rewrite is a repair, not a formatter.** It fires only when strict `JSON.parse` fails *and*
  the transform succeeds. Text that already parses strictly is never touched. For multi-line stage
  bodies the transform rewrites tokens in place, so the user's line breaks and indentation survive.

- **A destructive operation always shows the Canonical EJSON it will actually run.** The delete
  confirm shows the real filter, never a friendlier rendering of it.

- **Explicitly not done: the Filter Bar text does not gain a symbolic dialect.** Symbols (`>`, `!=`)
  are a Query Builder concern only — see the section on them below. The Filter Bar holds real MQL so
  it round-trips to mongosh, to the shell, and to saved queries by copy and paste.

## Considered Options

- **Make the app strict-consistent instead** — quote the stage templates and help examples, keep
  the strict validator everywhere. Much cheaper, and it does fix the app's disagreement with
  itself. Rejected because it leaves the app permanently at odds with mongosh, Compass, and every
  tutorial. Users paste from those sources daily; that is a fight the app cannot win by being
  internally tidy.

- **Evaluate the AST into JavaScript values, then serialize** — far easier to write. Rejected
  because it silently destroys integer precision. `filterTree.ts:265-278` documents a deliberate
  choice to hold value *text* and guard integers at print time with `isUnsafeNumber`;
  `9007199254740993` becomes `…992` the instant it passes through a JS double, and the user gets
  wrong rows with no error. It would also drag in the manually-mirrored `src/utils/ejson.ts` ↔
  `electron/mongo/ejson.ts` pair as a second failure surface.

- **Accept Shell Syntax across the IPC boundary** — let the main process do the conversion.
  Rejected: `CLAUDE.md` makes Canonical EJSON the wire format, and this would put a hand-written
  parser on the trust boundary.

- **Convert at `currentFilterJson` rather than at the input edge** — leaves Shell Syntax sitting in
  stored state and in the delete-all path. Rejected; the "stored text is always canonical"
  invariant is what keeps this change out of the main process entirely.

- **Tier 3 as one thing** — originally deferred whole, as "regex literals and general expressions",
  on the grounds that it needs an expression evaluator. That grouping was wrong, and it was later split.
  A regex literal is not an expression: acorn reports `/^a/i` as a `Literal` whose `regex.pattern`
  and `regex.flags` are **raw source text**, so it converts by the same span-copy rule as every
  other value and needs no evaluator at all. Regex literals are therefore **in** (see the Decision
  above); only general expressions stay out, and they are now rejected rather than deferred —
  arithmetic in a query input is what the second rejected option is about, and the evaluator that
  would enable it is the thing this ADR exists to avoid.

## Consequences

- A new renderer-side module (`src/utils/shellSyntax.ts`) becomes the single owner of the
  transform. It is pure, synchronous, and unit-testable on its own. `acorn` is pure JavaScript, so
  importing it in the renderer does not trip `check-renderer-purity.mjs`.

- `validateStageBody` routes through the transform before it reaches `isValidEjson`, which stays as the second gate. The
  `$group`/`$match` stage templates and the stage-picker help examples can then stay in the
  friendly dialect they are already written in.

- **`currentFilterJson` feeds two execution flows — the normal query path and `OpenDeleteAllModal`.**
  Any work touching it owes `gitnexus impact currentFilterJson` first. This is the highest-risk
  point in the change.

- The two-way Filter Bar ↔ Query Builder sync is unaffected: `printFilter` already overwrites the
  bar with canonical text on any builder edit (`applyEdit`, `BuilderPane.tsx:951`), which is consistent with
  the invariant rather than in tension with it.

- Error feedback becomes load-bearing. Fewer inputs fail, but the ones that do must say so: an
  inline message under the bar, and the stale result grid dimmed. Today a broken filter leaves the
  previous query's count on screen, so a failed query reads as "139 results" — the wrong count is
  the dangerous half of that defect, not the missing message.

- The transform emits `$regularExpression`, not the `$regex` / `$options` operator pair. Both read
  the same inside a filter and both survive a JSON round trip, so nothing in the repair path can
  tell them apart — but only `$regularExpression` is Canonical EJSON, so only it revives to a real
  `BSONRegExp` and re-serializes byte-identically. Regex flags are emitted sorted for the same
  reason: `bson` sorts them on the way out, so `/^a/mi` written verbatim would make a saved query
  differ from itself after one reload.

- **The write-surface deferral was later lifted, with a condition.** The original argument —
  a misread value corrupts a document instead of returning wrong rows — is true about the
  *consequence* and silent about the *likelihood*, and on inspection it says nothing about this
  transform in particular. The transform splices source spans and never evaluates, so there is no
  reading it can get wrong on a drawer that it would not equally get wrong in the Filter Bar. Held
  strict on that argument alone, the drawers were teaching a second syntax rule for no reduction in
  risk.

  What actually carries the safety is the rule two bullets down: **a destructive operation always
  shows the Canonical EJSON it will actually run**. On a write surface that rule has two halves,
  and they are worth separating because they act at different moments and give different
  guarantees:

  - **Repair is visible, and happens before the user commits.** Blur rewrites Shell Syntax to
    Canonical EJSON *in the box*, so what the user reads when Save is pressed is already the
    canonical form. Pressing Save blurs the textarea first, so this holds for the mouse path as
    well as the tab path. The save handler repairs again and acts on the returned text rather than
    on state, because a state patch has not rendered in the same tick. **Nothing is reinterpreted
    after the user has looked at it** — that is the whole safety claim, and it is about meaning.
  - **Normalization is invisible, and happens at the write.** The payload is re-stringified from
    the parsed value, so the wire carries one spelling regardless of what was typed. Whitespace and
    the readable sentinel forms do not survive this; the document does. This is about format, and
    it deliberately guarantees nothing about the *text* matching the screen.

  So the one rule is: **the user commits a buffer that already means what will be written, and the
  wire carries that same document in canonical form.** Byte-identity between the two was never the
  property — reading it that way is what let the drift below ship.

  One consequence that had to be handled rather than discovered later: `isValidEjson` gates the Save
  button, and a disabled button does not take the click that would have blurred the textarea. Gating
  on the raw buffer would have left a user with valid Shell Syntax, a greyed-out Save, and no way to
  find out why. The gate reads the *repaired* text.

- **The UX review's §4.1 finding was a separate problem on the same two drawers** — canonical EJSON
  (`{"$oid": …}`, `{"$date": …}`) in what the edit and insert surfaces *display*, not in what they
  accept. It stayed its own ticket precisely because input strictness and output rendering
  are independent, and it was fixed there rather than here.

  Worth recording what a later investigation found, because it is the same trap as this ADR's second rejected
  option wearing different clothes. The obvious fix — render with bson's relaxed mode, as Compass
  does — is **not** lossless on this repo's bson: `{"$numberLong":"9007199254740993"}` relaxes to
  `9007199254740992`. In a read-only view that is a wrong number on screen; in an editable drawer it
  is a wrong number the user saves. So `ejsonStringifyReadable` unwraps only what re-parses to the
  identical BSON — int32, fractional doubles, and dates as ISO strings — and leaves `$numberLong`,
  `$numberDecimal` and `$oid` wrapped. Because the output round-trips exactly, it is safe as the
  *edit* buffer and not merely as a display, which is what kept the change to one line per drawer
  instead of a second canonical copy held alongside.

  **"Safe as the edit buffer" is not the same as "safe on the wire", and review caught the gap.**
  `ejsonStringifyReadable`'s contract says nothing it renders crosses IPC. Two paths made that
  false: `EditDrawer`'s replace mode canonicalized only when it had to re-inject a removed `_id`,
  so an unedited save — the common case — submitted the buffer verbatim; and `InsertDrawer`
  submitted its buffer directly, which "Duplicate document" seeds from `stripIdForDuplicate`, a
  readable rendering. Nothing was written wrong, because the round-trip guarantee holds all the way
  down to BSON: a bare `67` and `{"$numberInt":"67"}` both reach the driver as `Int32`, and both
  spellings of `$date` revive to the same `Date`. What was wrong is that main's tolerance of the
  Relaxed spelling was incidental rather than promised, and this ADR's own invariant says the wire
  is Canonical. Both drawers now re-stringify from the parsed value before the write — the
  normalization half of the write-surface rule above, which this finding is what forced the ADR to
  state separately in the first place.

## Symbolic operators in the Query Builder

Originally recorded here as a scope note — the explicit boundary of the decision above. It stayed a
note for one release and was never filed, which is how a fully specified design goes missing:
recording something as a boundary is not the same as scheduling it. Later built; this section is
now the decision rather than the note.

The Query Builder's operator control is a free-text `TextInput` with a suggestion popover
(the `opInputRef` input, `BuilderPane.tsx:423`), not a `Select` — typed text goes straight into `node.op`. The symbol layer
is therefore: the popover *lists* symbols and English names alongside the operator; typing an exact
symbol (`>`, `>=`, `<`, `<=`, `=`, `==`, `!=`, `<>`, and the pasted forms `≥`, `≤`, `≠`) resolves to
the operator; and the input keeps showing `$gt`, not `>`. Keeping `$gt` in the box preserves the
teaching value and means `node.op` always holds a real operator, so `printFilter` and
`isCompilableOp` need no change.

Operators with no natural symbol get a short English `label` on `OperatorDef` — a new field, not
the existing `summary`, which is a sentence. The label applies in query context only: an aggregation
stage list keeps `$group`, because a pipeline is written in real operator names. That rule is
enforced by *where the table is applied* — only the `QUERY` section of the catalog is mapped — so
the `$type` a `$match` sees is labelled and the `$type` an expression sees is not, with no runtime
check to get wrong. The set is bounded by `isCompilableOp`: naming an operator makes it easier to
reach, and an operator the row would immediately flag as needing a raw clause is not worth reaching.

The trap the note named held up. `>` is a prefix of `>=`, so a per-keystroke map converts `>` before
the user can type the `=`. Resolution happens **when the user finishes the box, never per
keystroke** — which is also X14's commit point for Shell Syntax, so the builder and the Filter Bar
settle at the same moment. A per-keystroke mutant fails exactly one test, and it is that one.

"Finishes the box" was first read as blur alone, and that was wrong in a way no test could see
. Blur covers Tab and click-away; **Enter reaches no blur handler at all**, so `>` followed by
the keystroke that most means *done* left the symbol in an unprintable row. Every test for the
original ticket drove the conversion with `fireEvent.blur`, which calls the handler directly — they
asserted what the conversion produces and never which keystrokes reach it, so the whole component
layer was structurally blind to the gap. It took a person using the app. `tests/e2e/x14-builder-symbols.e2e.ts`
now pins all three endings, and it is an e2e test on purpose.

Enter carries two exclusions. The first is the popover clobber described below, reaching the same
row by a second route: an Enter the popover already consumed is left alone, or arrowing to `$in`
over a typed `>` lands `$gt`. The second is ⌘/Ctrl+Enter, which *runs the query* — resolving there
would repaint the box as `$gt` while the run still used the last-committed filter, since the patch
has not rendered. A row that still looks unfinished is the honest state, and that is the same
truthfulness rule the stale-count work in §5 is built on.

One consequence the note did not anticipate. The popover blurs the operator input on its way out, so
selecting a row runs the blur resolver next — against a `node.op` that has not re-rendered, because
`patch` spreads a stale `node` rather than taking a functional update. Choosing `$in` after typing
`>` would land `$gt`. A ref guard suppresses the resolve for a popover selection. It is defence
rather than a live fix: the ranker returns zero rows while the box holds a bare symbol, so there is
no row to click today.
