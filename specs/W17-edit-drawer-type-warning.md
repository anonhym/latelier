# W17 — A field-type warning in the Update drawer

## Purpose

`EditDrawer`'s Update mode writes a `$set` built from whatever EJSON the user
types. The buffer starts empty on purpose (the last-write-wins guard), so
there is nothing on screen to compare a new value against, and nothing in the
save path does that comparison either. A value that is syntactically valid
EJSON but the wrong *type* for the field — a bare string where every sampled
document carries an `ObjectId`, say — saves without a sound. MongoDB accepts
it; the app never looked.

The app already samples each field's observed type, for the Structure view
and for the Filter Bar's field hints. This spec wires that existing sample
into `EditDrawer`, as a warning, not a gate — the app tells the user their
value disagrees with the field's usual shape, and lets them decide.

## Scope

- **In**: `EditDrawer`, Update mode only. A warning line, shown when a `$set`
  field's value type disagrees with that field's dominant sampled type.
- **In**: extending `sampleSchemaSource`'s existing per-collection cache to
  also hold a `summarizeSchema()` digestion of the same fetched sample, so the
  warning costs no new database round trip.
- **Out**: `EditDrawer` Replace mode — a full-document retype already reads as
  deliberate.
- **Out**: `InsertDrawer` — a new document may legitimately set the pattern
  rather than follow it.
- **Out**: nested or dotted `$set` keys (e.g. `address.city`, or a nested
  object value). Top-level keys only, this version.
- **Out**: blocking Save. A type disagreement is never fatal — MongoDB has no
  fixed per-field type, and the sample can be wrong or stale.

## Dependencies

- `sampleSchemaSource.ts` (field-suggestion cache) — extended, not replaced.
- `schemaSummary.ts` (`summarizeSchema`, `SchemaSampleEntry`) — the digestion
  this spec adds to the cache; unchanged itself.
- `CONTEXT.md` — "Structure" is the existing term for this sampled-shape
  concept; no new term is introduced.

---

## 1. The cache gains a second digestion

`sampleSchemaSource.ts` fetches `api.meta.sampleSchema` once per
`connectionId:dbName:collection` key, per its five-minute TTL, and caches the
result as a `FieldSuggestion[]` (via `lastRunSource`'s walk). That walk keeps
only the *first* type it sees per field, and a raw document count — not
enough to say "one type dominates." `summarizeSchema()` already computes what
this spec needs: a per-field type histogram over the whole sample.

The fetch is not duplicated. The same `docs` response feeds both digestions:

```ts
interface CacheEntry {
  fetchedAt: number;
  suggestions: FieldSuggestion[];
  structureEntries: SchemaSampleEntry[]; // new
}
```

`structureEntries` is `summarizeSchema(res.docs)`, computed once alongside
`suggestions` inside the existing fetch/`inflight` block. A failed fetch caches
an empty array for both, the same fail-silent rule the suggestion side
already uses — no data, no warning, never a thrown error reaching the drawer.

A new accessor sits beside the exported `sampleSchemaSource`:

```ts
export async function getStructureEntries(
  connectionId: string,
  dbName: string,
  collection: string,
): Promise<SchemaSampleEntry[]>;
```

It shares the cache key, the TTL, and the in-flight map with the existing
function — calling both for the same collection within the TTL window issues
one fetch, not two.

Sharing the in-flight map is the part that fails silently if it is got wrong.
`inflight` is `Map<string, Promise<FieldSuggestion[]>>` today; two accessors
returning different shapes off one fetch means it has to become
`Map<string, Promise<CacheEntry>>`, with both public functions projecting the
field they want out of the resolved entry. Giving each accessor its own
in-flight entry compiles, passes every existing cache test, and quietly
doubles the sample call — so the "one fetch, not two" criterion below is the
one to validate by mutation.

## 2. The dominance check

A pure function, colocated with `schemaSummary.ts` since it reads
`SchemaSampleEntry` and nothing renderer-shaped:

```ts
interface TypeWarning {
  field: string;
  expectedType: string;
  actualType: string;
  percent: number; // 0-100, rounded, of the dominant type among this field's own typed occurrences
}

function checkFieldType(
  entries: SchemaSampleEntry[],
  field: string,
  actualType: string,
): TypeWarning | null;
```

`actualType` is a string from `schemaSummary.ts`'s own `inferType`, which this
spec promotes from module-private to exported. It is deliberately **not**
`DisplayType` from `displayValue.ts`, even though the two vocabularies overlap
almost entirely — the comparison here is against `entry.types`, whose keys are
produced by `inferType` and nothing else. Two near-identical vocabularies
either side of an equality check is a drift bug waiting to happen, and the two
already disagree in both directions: `inferType` has `timestamp` and
`DisplayType` does not; `DisplayType` has `undefined` and `inferType` emits it
only for a literal `undefined` that JSON cannot carry; and `toDisplayValue`
matches `$regex` but not `$regularExpression`, which is the sentinel Canonical
EJSON actually emits. Sharing one function makes the vocabularies equal by
construction, with no mapping table and no drift test to maintain.

For a given `field`, find its entry in `entries`. If none exists — the field
was never sampled — return `null`; there is nothing to compare against, and
absence of data is never treated as disagreement.

Otherwise compute each type's share **within that field's own type histogram**:
`entry.types[type] / sum(Object.values(entry.types))`. This is deliberately
not divided by the overall sample size — a field's `types` counts already
represent only the documents (or, for a mixed array, the per-document type
occurrences) where the field appeared, so comparing a type's share against
the sum of that same field's counts is the direct "how dominant is this type,
among the times this field showed up with a type" answer, with no second
number (total sampled doc count) to thread through the cache.

If the dominant type's share is `< 0.9`, return `null` — the field is already
mixed in real data, and a new value of a different type is not obviously
wrong (Q4/round 1). If the dominant type's share is `≥ 0.9` and disagrees with
`actualType`, return the warning. If it agrees, return `null`.

## 3. The warning in `EditDrawer`

Update mode's `handleSave` already parses the submitted patch into a record
before building `$set` (`EditDrawer.tsx:154-172`). A second, read-only parse of
`canonical` — recomputed on every buffer change (not only on save) via a
`React.useMemo` keyed on `canonical` — is walked one top-level key at a time:

- parse with **`JSON.parse`, not `ejsonParse`**. `ejsonParse` revives sentinels
  into `bson` class instances (`ObjectId`, `Date`, `Long`, …), and `inferType`
  recognises a type by its *sentinel shape* (`'$oid' in v`), which a revived
  `ObjectId` no longer has. Feeding it revived values would classify every
  BSON-typed value as `object` and fire the warning on a correct
  `{"$oid": "…"}` edit — the exact false positive this spec exists to avoid.
  `JSON.parse` leaves the sentinels intact, which is also the shape
  `api.meta.sampleSchema` returns (`MetaService.sampleSchema` encodes with
  `relaxed: false`), so both sides of the comparison see the same form of the
  same value. A `JSON.parse` throw is impossible here — `isValid` gates the
  memo — but is caught and treated as "no warnings" regardless;
- for each key, call `inferType` (§2) on the parsed value;
- call `checkFieldType(structureEntries, key, inferredType)`;
- skip any key containing a `.`, and any key whose `inferType` is `object` —
  §8's nested/dotted deferral. Keying the second rule on `inferType` rather
  than on "is a JS object" is what keeps `{"$oid": "…"}` in scope: an exact
  sentinel wrapper is a scalar BSON value, and `inferType` returns `objectid`
  for it and `object` only for a genuine sub-document;

**Exactness is what makes that last rule true**, and `inferType` has to borrow
bson's own definition of it rather than test `'$oid' in v`. `ejson.ts`'s
`walkRevive` revives a wrapper only when it is the *whole* object
(`isExactSentinel`: one sentinel key, or `{$code, $scope}`), so
`{"$oid": "…", "extra": true}` is left a plain object and `updateOne` stores a
sub-document. A membership test alone would type that value `objectid` and
warn "this value is objectid" about something that is not one. `ejson.ts`
therefore exports `isExactSentinel`, and `inferType` returns `object` for
anything that fails it — which also corrects the same misreading in the
Structure view, since `summarizeSchema` shares the function.
- collect every non-null result.

`structureEntries` is fetched once per drawer mount via
`getStructureEntries(connectionId, dbName, collection)`, the same three props
`EditDrawer` already receives — no new prop.

Rendering: one line per warning, directly below the textarea and above the
existing `refusal`/`err` messages, in `T.textMuted` rather than `T.warn` — a
note, not the stop-sign styling those two already use, because this warning
never disables Save. Shown only while `isValid` is true (nothing to check in
an unparseable buffer) and only in Update mode.

Wording, one warning per disagreeing field:

> Field "`<field>`" is usually `<expectedType>` (`<percent>`% of sampled
> documents). This value is `<actualType>`.

Multiple disagreeing fields in one patch show as multiple lines, in the
patch's own key order.

---

## 4. Types

```ts
// src/features/fieldSuggestions/sources/sampleSchemaSource.ts
export async function getStructureEntries(
  connectionId: string,
  dbName: string,
  collection: string,
): Promise<SchemaSampleEntry[]>;
```

```ts
// src/pages/Workspace/schemaSummary.ts
export interface TypeWarning {
  field: string;
  expectedType: string;
  actualType: string;
  percent: number;
}

export function checkFieldType(
  entries: SchemaSampleEntry[],
  field: string,
  actualType: string,
): TypeWarning | null;

/** Already exists, module-private today; this spec exports it unchanged. */
export function inferType(v: unknown): string;
```

No change to `shared/types.ts` — `SchemaSampleEntry` already carries what §2
needs.

## 5. IPC contract

No new channel, no changed payload. `getStructureEntries` calls the same
`api.meta.sampleSchema` the suggestion cache already calls, through the same
cache key. `ipc-channel-auditor` has nothing new to audit.

---

## 6. Acceptance criteria

Single tier — the whole spec is one ticket.

- [ ] `sampleSchemaSource`'s cache entry holds `structureEntries` alongside
      `suggestions`, computed from the same fetched `docs`, on the same fetch
      and the same TTL.
- [ ] `getStructureEntries` and `sampleSchemaSource` share one in-flight fetch
      per collection within the TTL window — calling both does not double the
      sample call.
- [ ] `checkFieldType` returns `null` for a field with no sampled entry.
- [ ] `checkFieldType` returns `null` when the dominant type's share is below
      90%, regardless of agreement or disagreement with `actualType`.
- [ ] `checkFieldType` returns `null` when the dominant type (≥90% share)
      agrees with `actualType`.
- [ ] `checkFieldType` returns a `TypeWarning` with the correct rounded
      `percent` when the dominant type (≥90% share) disagrees.
- [ ] `EditDrawer` shows one warning line per disagreeing top-level field,
      only in Update mode, only while the buffer is valid EJSON.
- [ ] A BSON-typed value written in its sentinel form (`{"$oid": "…"}` against
      an `objectid` field) is read as that type, not as `object` — no warning
      on correct input.
- [ ] A sentinel key mixed with other keys (`{"$oid": "…", "extra": true}`) is
      read as `object`, agreeing with what `ejsonParse`/`updateOne` actually
      store, and is therefore skipped rather than mislabelled.
- [ ] The warning never disables Save, and Save behaves exactly as before —
      §3's check is read-only.
- [ ] A nested or dotted `$set` key is not checked (out of scope, not
      silently mis-checked as a top-level miss).
- [ ] Replace mode and `InsertDrawer` show no warning.

## 7. Test cases

### Unit — `tests/unit/schema-summary.spec.ts` (extend)

- a field entry with one type at 100% share, actual type matches → `null`;
- a field entry with one type at 100% share, actual type differs → a
  `TypeWarning` with `percent: 100`;
- a field entry split 92/8 between two types, actual type is the minority one
  → a warning naming the 92%-share type as `expectedType`;
- a field entry split 60/40 → `null`, regardless of `actualType`;
- a field absent from `entries` → `null`;
- percent rounding: a 0.895 share (edge of the 90% cutoff, rounds to 90 for
  display) is still treated as `< 0.9` and returns `null` — the cutoff reads
  the unrounded fraction, not the displayed integer.

### Component — `tests/component/sample-schema-cache.spec.ts` (extend)

The cache's existing coverage lives here, not under `tests/unit/` — the suite
needs a `window.atelier` stub and module-level cache state reset between
cases, which is why it was filed as a component test despite testing a
non-React module.

- `getStructureEntries` and `sampleSchemaSource`, called for the same
  collection inside the TTL window, resolve from one fetch (assert the mock
  `api.meta.sampleSchema` is called once, not twice);
- a failed fetch caches an empty `structureEntries` array, the same as it
  already does for `suggestions`;
- the TTL and per-collection cache key behave identically to the existing
  suggestion-only tests — no regression to that path.

### Component — `tests/component/edit-drawer-update-set.spec.tsx` (extend)

`EditDrawer` has three component specs (`edit-drawer-id-reinjection`,
`edit-drawer-readable-ejson`, `edit-drawer-update-set`); Update-mode-only
behaviour belongs in the last.

- Update mode, a patch with one disagreeing field, sampled data available →
  the warning line renders with the expected wording;
- Update mode, a patch with a field that agrees, or has no sample, or is
  below the 90% cutoff → no warning;
- the warning renders in the muted style, not `T.warn`, and Save stays
  enabled;
- Update mode, `{"_id_ref": {"$oid": "…"}}` against a field sampled as
  `objectid` at 100% → **no** warning. This is the regression guard for §3's
  parse rule: an `ejsonParse`-based implementation reads the revived
  `ObjectId` as `object`, disagrees with `objectid`, and warns on correct
  input;
- an invalid EJSON buffer shows no warning, only the existing `refusal`/`err`
  treatment;
- Replace mode never renders the warning, regardless of buffer content;
- a nested key (`"address.city"` or `{"address": {...}}`) in the patch is not
  checked and produces no warning, even when the corresponding top-level
  entry (`address`) would have disagreed.

## 8. Out of scope

| Deferred | Why |
| --- | --- |
| `InsertDrawer` | round 1, Q1 — a new document may set the pattern, not follow it |
| Replace mode | round 1, Q1 — a full retype already reads as deliberate |
| Nested/dotted field paths | round 1, Q5 — real work, deferred until the top-level version proves useful |
| Blocking Save on a type disagreement | round 1, Q2 — MongoDB has no fixed per-field type; a block would stop valid saves |

Implemented as.
