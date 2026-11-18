# W04 — Query builder pane (state + compile)

> **Status: Implemented.** §1–§4, §7 and §8 are superseded by [W13](./W13-filter-tree-editor.md), and the saved-queries strip in §6 was removed.

> **Partly superseded by [W13](./W13-filter-tree-editor.md).** W13 replaces the
> `BuilderState.conditions` container model and the compile/parse contract with
> a filter tree parsed from canonical EJSON text — §1–§4, §7 (including the
> fail-closed guard), and §8 below describe the shipped pre-W13 behavior
> and are frozen. Still authoritative and
> reused verbatim by W13: **§2a** (shape buckets), **§2b**
> (condition problems, now `filterTree.ts`'s `condValueProblem`), **§5**'s
> condition-row layout and the two autocompletes, and the **`FIELD_OPS`**
> table.

## Purpose

The right-hand "Builder / Saved / Recent" pane that lets users assemble a MQL `find` without typing raw JSON. Owns a normalized condition list, AND/OR logic, projection, sort, limit, and the bidirectional compile contract (builder → MQL → builder).

## Scope

- **In**: Condition rows (add/edit/remove), AND/OR toggle, projection chips, sort/limit inputs, `compileMql(state)`, `parseMqlToBuilder(mql)` (best-effort), Saved tab integration hook, Recent tab integration hook.
- **Out**: The query bar itself (W05), the actual running (W03), Saved/Recent CRUD (W09/W10).

## Dependencies

- W01, W03, W09, W10.

## 1. Types

```ts
// shared/types.ts
//
// MqlOp is the compiler-known set — the ops `compileMql` can encode as a
// simple `{ field: { $op: value } }` pair. `Cond.op` is a `string`
// because the user can type any op via autocomplete (see X03); the
// compiler flags rows with unknown ops via the §2b check.
export type MqlOp =
  | '$eq' | '$ne' | '$gt' | '$gte' | '$lt' | '$lte'
  | '$in' | '$nin' | '$regex' | '$exists' | '$type' | '$all'
  | '$mod' | '$size'
  | '$bitsAllClear' | '$bitsAnyClear' | '$bitsAllSet' | '$bitsAnySet';

export type ValType = 'string' | 'number' | 'boolean' | 'date' | 'null' | 'regex' | 'objectid' | 'array';

export interface Cond {
  id: number;                 // monotonic within tab
  field: string;
  op: string;                 // any $-prefixed op; compiler validates
  valType: ValType;
  value: string;              // raw text; typed as per valType at compile time
}

export interface BuilderState {
  conditions: Cond[];
  logic: 'AND' | 'OR';
  projection: string[];       // field names to include (implicit `_id: 1`)
  sort: string;               // raw MQL, e.g. '{ date: -1 }'
  limit: string;              // raw number or empty
}
```

## 2. Compile — builder → MQL

```ts
interface CompiledMql {
  filter: string;
  sort?: string;
  projection?: string;
  limit: number | null;
  invalidCondIds: number[];    // rows flagged by the §2b check
}

compileMql(state: BuilderState): CompiledMql;
```

Algorithm:
1. **Filter**: for each active condition (field non-empty),
   `buildCondObject(cond)` produces `{ <field>: { <op>: <shapedValue> } }`.
   `<shapedValue>` depends on the op's shape bucket (see §2a).
   - If `active.length === 1` → the single clause IS the filter.
   - Else combine with `{ $and: [...] }` or `{ $or: [...] }` per `state.logic`.
2. **Projection**: if `state.projection.length > 0`, build
   `{ _id: 1, <f>: 1, ... }`. Empty ⇒ omit.
3. **Sort**: pass-through of `state.sort` (raw MQL). Empty ⇒ omit. The
   field validates as EJSON object before running.
4. **Limit**: parse as integer; empty or invalid ⇒ `null` (runner
   supplies default 50).
5. **`invalidCondIds`**: IDs of conditions whose op the compiler can't
   encode (`!isCompilableOp(op)`), whose op doesn't apply to the
   valType (op not in `FIELD_OPS[valType]`), or which have an
   op-specific value problem (`$mod` with a malformed or divisor-0
   value). See §2b.

All string outputs are EJSON canonical strings (F04 wire form).

### 2a. Shape buckets

`buildCondValue(cond)` dispatches by op:

| Bucket       | Ops                                                          | Value handling                                  |
| ------------ | ------------------------------------------------------------ | ----------------------------------------------- |
| simple       | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`                   | `buildTypedValue(cond)` per valType             |
| exists       | `$exists`                                                    | `true` (value field ignored)                    |
| in / nin     | `$in`, `$nin`, `$all`                                        | `parseJsonArray(value)` → `[]` on parse error   |
| regex        | `$regex`                                                     | raw `value` string                              |
| type         | `$type`                                                      | `Number(value)` if finite, else `value`         |
| mod          | `$mod`                                                       | `parseJsonArray(value)` — length 2 expected     |
| size / bits  | `$size`, `$bitsAll*`/`$bitsAny*`                             | `Number(value)` (0 on parse error)              |
| needs-raw    | anything not listed above (`$elemMatch`, `$text`, `$expr`, `$geo*`, `$jsonSchema`, all accumulators/expressions) | row flagged invalid; Run blocked |

`buildTypedValue(cond)` for the `simple` bucket keeps the valType
mapping from the original spec (`string` → quoted, `number` → numeric,
`boolean` → true/false, `date` → `{$date}`, `null` → `null`,
`regex` → `{$regex}`, `objectid` → `{$oid}`, `array` → parsed JSON).

### 2b. Condition problems — `condValueProblem(cond) → string | null`

Lives in `filterTree.ts` (W13) and is not exported. `printFilter` runs it on
every enabled condition whose field is not blank; a condition with a blank
field is pending and never reaches it. `toRawNode` uses it too: a condition
with a problem converts to a blank raw clause. It returns the first problem
it finds, in order:

1. Op doesn't start with `$` → `'Operator must start with "$"'`.
2. `!isCompilableOp(op)` → `'<op> is not encodable — convert to a raw clause'`.
3. An empty value (nothing typed, or blanks only for the numeric types) on a
   `string`, `number`, `long`, `decimal` or `regex` row, or on `$size`,
   `$type`, `$regex` or a bit-mask operator → `'Value is empty'`; it is never
   sent as `0` or `""`. `boolean`, `null` and `$exists` rows are never empty.
   A scalar value that isn't a value of its type: `'Value must be a valid
   number'` (`number`), `'Long value must be an integer'` (`long`),
   `'Decimal value must be a number'` (`decimal`), or the precision message
   for a `number` beyond 2^53.
4. For `$in`/`$nin`/`$all`: a raw number element beyond 2^53 (precision
   message); an empty list → `'<op> needs at least one value'`; an element
   that fails rule 3 for the row's type; on a `boolean` row, an element other
   than `true`/`false` → `'Boolean value must be true or false'`.
5. A sent `{$oid}` that isn't 24 hex characters → `'ObjectId must be 24 hex
   characters'`; a sent `{$date}` that doesn't parse → `'Date must be a date,
   e.g. 2026-01-31T00:00:00Z'`.
6. `$mod`: not a 2-element array → `'$mod value must be a 2-element array,
   e.g. [2, 1]'`; then `'$mod divisor must be a finite number'`, `'$mod
   divisor cannot be 0'`, `'$mod remainder must be a finite number'`.

The precision message is `'Contains a number too large to represent exactly
— use {"$numberLong": "..."} or {"$numberDecimal": "..."} instead'`.

Applicability is not checked: an op outside `FIELD_OPS[valType]` prints and
runs, and no advisory for it is shown. `isCompilableOp(op)` enumerates the
shape buckets above.

A problem blocks the print: the drawer keeps `queryRaw` at its last good
value, pauses the live count, shows `⚠ N not applied: …` above the tree, and
puts the message on the row — under the value input when the op is
encodable, on the row otherwise.

## 3. Parse — MQL → builder (best-effort)

`parseMqlToBuilder(filterEjson: string): { ok: true; state: Partial<BuilderState> } | { ok: false; reason: string }`

Strategy:
- Parse EJSON. If not an object, fail.
- If the root is `{ $and: [...] }` or `{ $or: [...] }` with array items each of shape `{ field: { op: val } }`, extract each as a `Cond`.
- If the root is a single `{ field: { op: val } }`, one Cond.
- If anything else (nested `$or`, array ops, free-form expressions): fail with reason `'Contains operators the builder can\'t represent.'`
- Map typed value back to `ValType`:
  - `typeof 'string'` → `string`.
  - `typeof 'number'` → `number`.
  - `typeof 'boolean'` → `boolean`.
  - `{ $date: ... }` → `date`.
  - `{ $oid: ... }` → `objectid`.
  - `{ $regex: ..., $options: ... }` → `regex` (ignore options in iteration 1).
  - `null` → `null`.
  - `Array` → `array`.

Consumers handle `ok: false` by disabling the builder and showing W05's "cannot sync" state.

## 4. Reducer / hook

```ts
// src/pages/Workspace/builder.ts
type Action =
  | { t: 'addCond'; field: string }
  | { t: 'patchCond'; id: number; patch: Partial<Cond> }
  | { t: 'removeCond'; id: number }
  | { t: 'setLogic'; v: 'AND'|'OR' }
  | { t: 'toggleProj'; field: string }
  | { t: 'setSort'; v: string }
  | { t: 'setLimit'; v: string }
  | { t: 'hydrate'; state: BuilderState };
function reducer(s: BuilderState, a: Action): BuilderState;
```

Exported helpers:
- `useBuilder(tabId)` — reads initial state from the active tab's `state.builder`, dispatches via reducer, persists diffs through `api.tabs.update(tabId, { state: { builder: next } })` (debounced).
- `compileMql(state)` and `parseMqlToBuilder(s)`.

## 5. UI (existing mock, wired real)

The existing Workspace's right pane is the home for this. Structure:

- **Tabs row**: `Builder` / `Saved` / `Recent`. Active tab styling already in mock.
- **Builder tab content**:
  - Conditions section: list of `CondRow`s, AND/OR pills, "+ Add condition" button.
  - Projection section: chips. Clicking toggles.
  - Sort + Limit row: two small inputs.
  - "Saved for {collection}" section (optional, W09): renders if there are any saved queries targeting this collection.
- **Saved tab content**: list from `api.saved.list({ connectionId, dbName, collection? })` (W09). Each row has `Run here` + `Open in new tab`.
- **Recent tab content**: list from `api.recent.list(...)` (W10). Each row has `Run here` + `Copy MQL`.
- **Footer**: `Reset`, `Copy code`, `Open as pipeline`.
  - `Copy code` is a menu: mongosh, Node.js, Python. It copies the find as run (the page's skip and limit), refused when the query will not run. Each document is a plain literal in the snippet's language; each exact EJSON sentinel in it (and only the sentinel, so `{ $regex, $ne }` stays an operator document) goes through the driver's EJSON parser, so an ObjectId filter pastes as working code. Python gets sort direction words as 1/-1, which PyMongo does not map itself. Of the find options (W14 §9) it carries the collation and the hint — `.collation()`/`.hint()` in mongosh, find options in Node, keyword arguments in Python (a key-pattern hint as a list of pairs, like sort) — because a collation changes which documents match and a hint naming a sparse index can leave some out. `maxTimeMS` and the read preference are left out: neither changes the documents or their order.
  - `Open as pipeline` opens the collection's Aggregation view with the query as `$match`, `$sort`, `$limit` (the user's limit, not the page's) and `$project`; an empty `{}` filter, sort or projection is omitted. Bodies are verbatim except that a sort's "asc"/"desc" words become 1/-1, which `$sort` requires. A filter using an operator `$match` refuses (`$where`, `$near`, `$nearSphere`, at any depth) or a projection using a find-only operator (`$slice`, `$elemMatch`, positional `field.$`) opens nothing and says why. A dirty pipeline asks before it is replaced.

### Condition row layout

Each `CondRow` is two lines, laid out on a grid whose shape follows the row's
type and operator and never the typed text, so typing cannot move anything:

- **Line 1**: include checkbox, `field` input (flex-fills), `op` input (monospace, 56 px, 92 px
  once the committed operator is longer than five characters), and the `⋮` row menu. There is no
  delete button on a condition: *Remove* is the last item of the `⋮` menu.
- **Line 2**: the value box, full width, its left edge on the field input's and its right edge on
  the operator's (so the `⋮` column stays free beneath it). The value editors (text, chips for a
  list, the date picker beside a date's text) sit inside it without a border of their own; the box
  has the input border, the accent focus ring, and a red border when the row has a value problem.
  It grows downward only: chips wrap onto more lines, and a long text value grows the box up to 4
  lines.
- **Type chip**: the value type is a small chip button at the box's right end, in sentence case
  (`string`, `number`, `date`), named *Value type: &lt;type&gt;*. It opens a menu of the types, and
  picking one changes the row exactly as the old select did (the operator moves to one the new
  type offers when it must).
- **Nothing to type**: `boolean` and `$exists` have no line 2. A two-option switch (`true | false`,
  `present | absent`) sits on line 1 between the operator and `⋮`. `null` has no control at all.
  Because these rows have no chip, the `⋮` menu carries a *Value type* submenu for them, so no type
  is a dead end.
- **Helper line**: one line under the value box, in 11 px. Several things can want it at once, so
  only the most urgent shows: a value problem, then an Undo notice, then a type hint, then plain
  information (`pickHelperLine`; the first listed wins among equals). The problem text is the value
  input's accessible description. Row-level warning text from the §2b check renders beneath all of it.
  Information is a parsed date's `ISODate("…")` form, or an ObjectId's date.
- **Value editors**: the box follows the type and never changes the row's grid.
  - *Text* grows with what is typed up to 4 lines, then scrolls inside the box.
  - *ObjectId* is shown whole, never abbreviated. A valid one shows "created `<date time zone>`" as
    its helper line, from the id's own timestamp, in the machine's time zone
    (`2026-11-18 08:01:24 EST`). The formatter takes the time zone as an argument, so a later
    setting can pass the person's choice; an unknown zone name throws rather than falling back. An
    id that is not 24 hex digits shows no date.
  - *List* (`$in`, `$nin`) is a box of chips. Typing a comma, a tab or Enter ends a chip. Pasting splits on
    comma, newline and tab, trims every piece and drops the empty ones, so a spreadsheet column or a
    trailing newline pastes as clean chips. Quotes are not read by the split: a chip's text is
    interpreted afterwards as a typed chip is.
  - *Object*: a document value is not a kind of its own. It is a raw clause (W13 §2b), whose
    editor is capped at 6 lines, then scrolls; it is not resizable.
- **Caps**: a list shows 3 lines of chips at rest and 8 while focused or expanded, then scrolls
  inside the box. A list too long for the resting cap shows a footer "N values · Show all" (and
  "Show fewer" once expanded). The footer counts chips instead of measuring them, so it may offer
  "Show all" for a list that would have fit.
- **Wide builder**: when the builder is at least 560 px wide (measured on the root group, not the
  window; the panel resizes between 320 and 640 px) the value box moves up beside the operator,
  and the field takes about 40% of what is left.

### Kind changes

A row's kind changes when its field names a field the sample types differently, when the type chip
is picked, or when the operator moves between one value and a list. Nothing typed is lost: a value
converts only when its text reads as the new kind under the printer's own rules (`printFilter`
accepts it as that kind; a bare "12" is not a date, a date needs an ISO date start). Text is never
rewritten, so a value converted to another kind and back is unchanged. The behaviour hangs off one
option (`KIND_CHANGE_OPTIONS.autoConvert`, on by default) so a setting can drive it later.

- **Field change**, for a single-value comparison with a sample entry for the new field:
  - an empty box adopts the sampled type (and moves the operator if the type does not offer it), and
    the chip flashes once;
  - a value that reads as the sampled type converts, and the helper line says "Changed to `<type>`
    to match `<field>`" with an *Undo* (the tree's own undo, one step);
  - a value that does not read as it stays, and the helper line says "`<field>` is a number in
    every sampled document" ("most sampled documents" below 100%) with a *Use number* action. With
    `autoConvert` off a value that would convert is only offered the same way.
  - a field with no sample entry, or a `null` row, is left alone. An empty box adopts the field's
    type, whatever the operator.
- **Chip change**: the value converts when it reads as the picked type, and otherwise stays and the
  row shows its usual value problem.
- **Operator change between `=` and `$in`**: `=` to `$in` makes the value the first chip; `$in` to
  `=` keeps the first chip and drops the rest, and the helper line names the removed chips (three,
  then "and N more") with *Undo*. A loaded `$in` is typed `array`; the first chip decides the row's
  type on the way back. A value no chip can hold faithfully stays as typed and the operator changes
  without the conversion.

### A field with two types

`fieldTypeSplit` turns a sampled field's type counts into a list of types, commonest first, with
whole-percent shares that always add up to 100 (largest remainder; ties in `localeCompare` order;
a type too rare to earn one percent is left out). A field is *mixed* when it has two or more types
and the commonest holds under 90% of the sample, the same bar `checkFieldType` (W17) calls dominant.

For a mixed field, on a single-value row:

- The type chip shows the type the row sends with a two-colour dot of the two commonest types.
- The chip menu lists the sampled types first, each with "N% of sample", then the other types.
- When the typed value matches only part of the sample, the helper line (a type hint) says "Skips the
  N% that store `<field>` as a number" (types joined by "or"), with a *Match either* action. When no
  other sampled type can hold the value, it says that only values of the sent type can match,
  and offers nothing.
- *Match either* (`MATCH_EITHER_OPTIONS.offered`, on by default, so a setting can turn it off)
  turns the row into `$in` with one chip per sampled type that can hold the value
  (`["75001", 75001]`). It is offered only when both of the two commonest types can hold the value
  as chips of their own; a number and a long match the same documents, so they are not two sides.
  The row's chip then reads *either*.
- A sampled type with no editor (`binary`, `timestamp`, ...) is edited as text, the chip names the
  sampled type, and the helper line says what you type is compared as text and points to a raw
  clause. `ValType` gains no member and persisted tab state is unchanged.
- A field that is not in the sample gets a plain string box and no hint.

### Pattern options
- A `$regex` row shows four toggle buttons under the pattern box: `i` ignore case, `m` multiline,
  `s` dot matches newline, `x` ignore whitespace. A lit button is a letter in the condition's
  `options`, sent as `$options` in `imsx` order; none lit sends a bare `$regex`. The helper line
  names the lit options. No slashes are drawn around the pattern.
- Leaving `$regex` for another operator drops the options and says so ("Pattern options i, m were
  removed") with Undo.
- The Contains text (any case) starter is an empty pattern with `i` lit.

### Conditions field selector
- On focus, the `field` input shows a field-name autocomplete popover
  (X02). The builder pane owns the popover directly (input anchor, no
  textarea glue) and splices the selected path into the condition via
  `dispatch({ t: 'patchCond', patch: { field: s.path } })`. The field
  input uses `DEFAULT_FIELD_SOURCES` — operators are intentionally
  excluded here.

### Condition op selector *(X03)*

- The op is a monospace `<input>` with its own autocomplete popover
  driven by `[operatorSource]` and `operatorContext: 'matchKey'`. The
  popover offers the full catalog; query-side ops rank first.
- Users can type any `$`-prefixed op; the compiler (§2) decides whether
  it's representable.
- The input renders in its error state (`aria-invalid`) when the §2b
  problem is about the op (rules 1–2), and the message shows under the
  row. A value problem marks the value input instead.
- On accept, dispatches `{ t: 'patchCond', patch: { op: s.name } }`.

### Applicable ops per valType — `FIELD_OPS`

Used when a row's valType changes: the row keeps its op if the new type's
set holds it, and otherwise switches to that set's first op. Ops outside
this set still appear in the popover (the catalog is the source); the
§2b check does not flag them.

| valType   | Ops                              |
| --------- | -------------------------------- |
| string    | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$regex`, `$exists`, `$type` |
| number    | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$exists`, `$type`, `$mod`, `$bitsAllClear`, `$bitsAnyClear`, `$bitsAllSet`, `$bitsAnySet` |
| boolean   | `$eq`, `$ne`, `$exists`, `$type` |
| date      | `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$exists`, `$type` |
| null      | `$eq`, `$ne`, `$exists`, `$type` |
| regex     | `$regex`, `$exists`, `$type`     |
| objectid  | `$eq`, `$ne`, `$in`, `$nin`, `$exists`, `$type` |
| array     | `$in`, `$nin`, `$all`, `$exists`, `$type`, `$size` |

## 6. "Saved for this collection"

Renders up to 5 saved queries scoped to `(connectionId, dbName, collection)`. Each row:
- `Run here` → replace the Builder state with the saved payload + call Run.
- `Open in new tab` → open a duplicate tab via W01 and hydrate.

## 7. Compile errors

`compileMql` returns `invalidCondIds` — conditions caught by
the §2b check. When that list is non-empty:

- Run is disabled with tooltip `"One or more conditions need raw JSON mode"`.
  This applies to **both** Run buttons — the pane's and W05's — which share
  one gating rule.
- Each offending row renders `aria-invalid`, a warn-colored border
  around the op input, and the message text under the value input.

The escape hatch for object-shape ops is the raw query textarea (W05)
— users flip to raw mode and hand-edit.

### 7a. Fail-closed execution guard **

`compileMql` still **emits** a flagged condition — `buildCondValue` falls
back to `buildTypedValue`, so an `$elemMatch` row compiles to
`{"items":{"$elemMatch":"{...}"}}`. That string is valid EJSON, which means
any "is this runnable" check testing only EJSON validity says yes.

`currentFilterJson(state)` therefore returns `string | null`, and returns
`null` when the builder holds a flagged condition and the tab is not dirty.
It is the single choke point every executor routes through:

| Consumer | Behavior on `null` |
| --- | --- |
| `useQueryRunner.run` | patches `lastRun.error` with `VALIDATION` and returns without IPC |
| Delete-all (`openDeleteAll` + the confirm) | refuses to arm; `notify.error` |
| `currentQueryKey` (hint counter) | falls back to a distinct `<invalid>` bucket |

`compileMql` must **not** be changed to drop flagged conditions instead.
That widens the compiled filter from mangled to `{}`, and delete-all reads
the same resolver — a widened filter there matches the whole collection.
The mangled string is also what the query bar shows and what the user
hand-edits to escape the flag.

## 8. Persistence

`BuilderState` is persisted as part of each collection tab's `state.builder` (W01 §2). Restoration is automatic when switching tabs or relaunching.

## 9. Acceptance criteria

- Adding a condition defaults to the first field, `$eq`, `string`, empty value.
- Changing `valType` resets `op` to the first op applicable for that
  type when the current op no longer fits.
- Toggling AND/OR with ≥ 2 conditions rewrites the compiled MQL envelope.
- Sort and Limit round-trip verbatim.
- Compile produces valid EJSON for every supported `valType`/op combination.
- Parse recognizes `{ field: { $op: val } }` and `{ $and: [...] }` / `{ $or: [...] }` shapes.
- Parse fails gracefully on free-form filters; the pane renders the "cannot sync" state.
- *(X03)* Op input offers the full operator catalog via autocomplete.
- *(X03)* Typing `eq` (no `$`) accepts `$eq`.
- *(X03)* Ops outside `FIELD_OPS[valType]` flag the row; Run is
  disabled with a tooltip.
- *(X03)* Object-shape ops (`$elemMatch`, `$text`, `$expr`, `$geo*`,
  `$jsonSchema`) flag the row as "needs raw JSON"; Run is disabled.
- *(X03)* Malformed `$mod` values (empty, single-element,
  divisor-0) are caught pre-run.
- An empty value on a typed row is a "Value is empty" problem: red
  value box, the field named in the status line, left out of the
  filter.
- A condition is two lines at a panel under 560px (field, operator,
  `⋮`; then the value box with its type chip) and one line from 560px.
  Typing never changes the row's shape. Boolean and `$exists` rows are a
  switch on the first line; only a parsed date and an ObjectId's creation time have a preview line;
  *Remove* lives in the `⋮` menu.
- A value box has one helper line: a problem, an Undo notice, a type hint or information, the most
  urgent only. The text box grows to 4 lines and scrolls beyond; an ObjectId shows whole with its
  creation date in the local time zone.
- A list pastes as chips split on comma, newline and tab with no empty chip; at rest it shows 3 lines
  of chips and 8 while editing, with an "N values · Show all" footer when it is longer; an object
  raw clause is capped at 6 lines, then scrolls (always, with resize off).
- A field change converts a readable value with an Undo, keeps an unreadable one and offers the
  sampled type, and lets an empty box adopt it. A chip change converts or keeps the text with the
  value problem. `=` to `$in` keeps the first chip and `$in` to `=` names what it dropped, with Undo.
- A field whose commonest type holds under 90% of the sample shows a dot on the type chip and lists
  the sampled types with their shares; *Match either* makes the row an `$in` that matches both.
- ** A flagged condition disables **both** Run buttons, and
  blocks the runner even when invoked with no button involved
  (`query.run`, post-write re-runs).
- ** A flagged condition leaves delete-all unarmable rather than
  widening its filter to `{}`.
- ** Builder edits do not overwrite `queryRaw` while the tab is
  dirty; the only Save modal and the `query.save` command are owned above
  the pane so they survive it being collapsed **.

## 10. Test cases

### Unit
- **reducer.spec.ts**: each action transitions state correctly; `patchCond` only touches the identified id.
- **builder-compile.spec.ts**: fixture-based — (state) → (filter MQL,
  sort, limit, projection, `invalidCondIds`). Covers every valType,
  logic AND/OR, single-condition short-circuit, empty state → `{}`,
  each shape bucket (`$in`, `$mod`, `$size`, `$bits*`, `$regex`,
  `$type`), and `isCompilableOp` and `FIELD_OPS` boundaries.
- **filter-tree.spec.ts**: the §2b messages, through `printFilter`'s
  problems.
- **helperLine.spec.ts**, **kindChange.spec.ts**, **fieldTypeSplit.spec.ts**, **mixedField.spec.ts**,
  **listPaste.spec.ts**, **objectIdDate.spec.ts**: the helper line's order, `convertValue` and the
  field and operator plans, the split's sums and tie order, the mixed hints and *Match either*
  plan, the paste splitter, the ObjectId timestamp and the zone-argument formatter. The pure
  helpers also have property tests (no empty chip; shares sum to 100; a value converted to a kind
  and back is unchanged when both read it; `ObjectId.createFromTime` round-trips).
- **parseMqlToBuilder.spec.ts**: round-trips for supported shapes;
  failures for free-form filters; recognizes `$and`, `$or`, `$date`,
  `$oid`, `$regex`.

### Component
- **add-remove-cond.spec.tsx**: interactions with mocks observe correct reducer actions.
- **invalid-number.spec.tsx**: typing "abc" into a number condition disables Run and shows an outlined row.
- **projection-chips.spec.tsx**: clicking chips toggles selection; compiled projection reflects state.
- **sort-limit.spec.tsx**: text inputs update compiled output.
- Value editors, one test per kind and the shared frame, error and chip asserted once over every
  kind in a table test; the list's caps and footer; the object raw clause cap; kind changes and the
  mixed-field cases, through a stateful wrapper so each patch round-trips into props.
- **saved-section.spec.tsx**: mock returns one saved query for collection → row visible; "Run here" hydrates state and triggers run.
