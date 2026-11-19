# X26 — Reference discovery from a copied value

> **Status: Implemented.**

## Purpose

When a value copied from one Collection is searched for in another Collection of the same Connection and a document turns up, the two fields are very likely a reference: `orders.customerId` holds a `customers._id`. The app offers to save that as a Reference Rule, once, inline, and never without a click. It is built on the **Copy Origin** from [X25](./X25-cross-connection-paste.md). Terms are as defined in `CONTEXT.md`.

## Scope

- **In**:
  - Knowing which field a copied value came from.
  - Remembering a paste on a query surface of a different Collection, and checking the next Run's documents for the value.
  - The inline suggestion strip: Save, Not now, Never for this pair.
  - Remembering a Never choice across restarts.
- **Out**:
  - The system clipboard: only the app's own copies are tracked, as in X25.
  - Pastes into stage bodies and the aggregation Run, the Document Editor and the shell.
  - Pastes across Connections (X25 warns about those and nothing here applies).
  - Inferring a rule from sample documents without a copy ([X05](./X05-document-references.md) `refs:autodetect`).
  - Any new IPC channel or migration.

## Dependencies

- [X25](./X25-cross-connection-paste.md): the Copy Origin and the paste hooks on the query surfaces.
- [X05](./X05-document-references.md): `refs:create` and the effective rule list.
- [X23](./X23-connection-families.md): a rule belongs to a Family or to one Connection. Saving follows the same default as the Reference Rules editor: shared with the Family when the Connection is in one, with "this connection only" as the alternative.

## 1. The source field

The Copy Origin gains an optional `fieldPath`, the dotted path of the field the copied text came from in the document of its Collection:

- **Value** copies (cell menu, Tree and field menus, the full-value popover, the Tree's per-field copy, ⌘C on a clicked Table cell) set it to that field's path.
- **Document id** copies set it to `_id`.
- A path through an array carries an element index (`items.0.sku`), which no rule's source field spells, so it names **no** field: nothing is suggested for it.
- Whole-document copies, the selection bar's multi-document copy, aggregation Output and text selected in a result view have **no** field path. A Copy Origin without one never starts a suggestion.

`copyToClipboard`'s `origin` argument accepts the optional `fieldPath` next to the Connection, Database and Collection. The Copy Origin also gets a `seq`, a counter that grows with each recorded copy, so "this copy" is identifiable (§5).

## 2. Pending discovery

A paste on one of the Collection tab's query surfaces (Filter Bar, Query Builder value, sort, projection) starts a **pending discovery** for that tab when all of these hold:

1. A Copy Origin is held and has a `fieldPath`.
2. Its `connectionId` equals the tab's, and its Database and Collection are not both equal to the tab's. A different Connection is X25's case, not this one.
3. At least one distinctive value of the Copy Origin (X25 §3) appears in the pasted text.

The pending discovery holds the tab id, the Copy Origin's Database, Collection, field path and `seq`, and the distinctive values that appeared in the paste. A later paste replaces it. It lives in renderer memory only. It does not depend on the X25 preference.

## 3. Match

When the tab's next Run finishes with at least one document, the pending discovery is taken (it is gone whatever happens next) and the documents are searched for its values.

- The documents are what the Run delivered: canonical Extended JSON, parsed but not revived, so an ObjectId is `{"$oid": …}`, an integer `{"$numberInt": …}`, and a UUID a `{"$binary": …}` of subtype `04`.
- A value **matches** a scalar leaf of a document when one of the leaf's text forms equals it exactly: a string as written; an ObjectId's hex; a plain number, `$numberInt`, `$numberLong`, `$numberDouble` or `$numberDecimal` as its decimal text; a `$binary` as its base64 text, and as its canonical UUID text when it is a 16-byte subtype `04`. Hex ids and UUIDs compare without regard to case, as in X25. Dates, booleans, null and the rest are never matched. A value wrapper such as `{"$date": …}` is a leaf, never searched inside.
- Leaves are visited through nested objects and arrays, to depth 8. An array element's path is the array field's path, with no index, because a dotted path addresses array elements in a query.
- The **match field** is found in the first document holding a match. If `_id` holds one it wins, otherwise the first match in document order.
- No match, or a Run with no documents: nothing is shown and the pending values are dropped.

## 4. Orientation, pair, suppression

The suggestion is a rule `source → target`. A rule points at the key of the collection it references, so:

- By default the source is the Copy Origin (Database, Collection, field path) and the target is the tab's Collection with the match field.
- If the Copy Origin's field is `_id` and the match field is not, the rule is the other way round: the source is the tab's Collection with the match field, the target is the Copy Origin's Collection and `_id`. Copying a customer's id and finding it in `orders.customerId` suggests `orders.customerId → customers._id`.
- If both fields are `_id`, nothing is suggested.

**Pair key**: `connectionId|srcDb.srcColl.srcField->tgtDb.tgtColl.tgtField`, the oriented pair. It is what Never and Not now are recorded against.

The suggestion is **suppressed**, without any notice, when:

- the pair key is in the Never list (§6);
- the user chose Not now for this pair on the same copy (§5);
- the Connection's **effective** rules for the source Collection (`refs:list` with `effective: true`, enabled or not) already hold one for that source field, to any target.

## 5. The strip

One strip per tab, rendered under the Filter Bar, showing the pair as "Make **`orders.customerId` → `customers._id`** a reference?". `role="status"`. It has three native buttons:

- **Save**: `refs:create` with the pair as source Database, Collection, field and target Database, Collection, field. The owner follows X23: the Connection's Family when it is in one, otherwise the Connection. A Family member also gets **Save for this connection only**, which creates it on the Connection. Nothing is projected or templated: the rule is created with defaults and edited in the Reference Rules editor like any other. On success the strip goes, with a toast naming the rule. On an error the strip stays and the error is toasted.
- **Not now**: dismisses the strip, and the pair is not offered again for the same Copy Origin (`seq`). Copying something else, or the same value again, makes it eligible again.
- **Never for this pair**: dismisses the strip and adds the pair key to the Never list.

Escape inside the strip acts as Not now and calls `stopPropagation()`. A rule is never saved without a click on Save. Once the suggestion is decided, or replaced by another, the copied values it was built from are dropped. Only the pair identity is kept.

The strip stays until decided or replaced by another suggestion for the tab. Like the X25 warning, its state is a small renderer-side entry per tab that is never persisted.

## 6. The Never list

`app_state` key `refs.discovery.never`, read and written through `api.prefs`: a JSON array of pair keys, each at most 1,024 characters, at most 500 entries. It is plain text, so it is inspectable like any other preference. Adding a key appends it, and when the list is full the oldest entry goes. It is on the renderer's `prefs` allowlist (`electron/ipc/prefKeys.ts`) with that schema. It carries no secret and needs no new channel.

## 7. Acceptance criteria

- Value copies carry their field path, document id copies carry `_id`, and document, multi-document, Output, selected-text and through-an-array copies carry none.
- A paste of a copied value on a different Collection of the same Connection, followed by a Run that returns a document holding the value, shows the strip with the oriented pair.
- The same paste on the Copy Origin's own Collection, on another Connection, or of text without the value, shows nothing.
- A Run with no match or no documents shows nothing, and the pending values are dropped.
- Save calls `refs:create` once with the pair and the owner of §5. It is never called otherwise.
- Not now hides the strip and does not re-offer the pair for that copy. Never does the same across restarts and for every later copy.
- A Connection whose effective rules already cover the source field gets no strip.
- Nothing is read from the system clipboard, and no copied value is persisted or sent to main.

## 8. Test cases

### Unit
- `reference-discovery.spec.ts`:
  - match by string, ObjectId, UUID, number, `Long`, `Decimal128`, nested object and array paths, depth limit;
  - `_id` wins, otherwise document order;
  - orientation for `_id` copies, both-`_id` and non-`_id` pairs;
  - pair key;
  - suppression by existing rule and by Never.
- `reference-discovery.property.spec.ts` (fast-check, real `bson` constructors): an ObjectId planted at a random path of a generated document is found at exactly that path.
- `prefKeys.spec.ts` (extend): `refs.discovery.never` accepts an array within the caps and rejects anything else.
- `copy-origin.spec.ts` (extend): `fieldPath` and `seq`.

### Component
- A paste into another Collection then a Run with a hit shows the strip, and a Run with no hit shows none.
- Save calls `refs.create` with the right pair and owner, for a Family member too, and "this connection only" with a Connection owner.
- Never writes the pref and suppresses a re-offer. Not now suppresses it for the same copy only.
- A same-Collection paste, and an existing effective rule, show nothing.
- The strip never saves by itself.
- `reference-discovery-strip.spec.tsx`, with a stateful wrapper: Escape with `stopPropagation`, proved by a parent spy.
