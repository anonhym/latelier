# X23 — Connection Families

> **Status: Implemented.** The decisions behind this spec are in [ADR 0015](../docs/adr/0015-connection-families.md).

## Purpose

Let several Connections that reach separate deployments of the same schema (one per client, say) share configuration instead of each one being set up by hand. A **Connection Family** is a named set of Connections. Its members share **Reference Rules** and **Row Summaries**, and each member can **Override** a shared setting on itself alone. The data is never shared: members are separate servers. Terms are as defined in `CONTEXT.md`.

## Scope

- **In**:
  - The `connection_families` table, and a Connection's membership (at most one Family).
  - Reference Rules owned by a Family as well as by a Connection, with per-rule Overrides and one resolution path every surface reads through.
  - The **Row Summary**: a saved, per-Collection choice of the fields a collapsed Tree row shows, owned by a Connection or a Family, with the same Override rules.
  - Family management in the Connections table: a Family column, membership actions, and a Family view.
  - Badges (**Shared / Overridden here / Local**) and **Reset to shared** in the Reference Rules editor.
  - Leaving and deleting a Family, with the offer to keep shared settings as local copies.
  - The Family name, read-only, in the Connection Switcher and Tab Group headers.
- **Out**:
  - The Family Export file: [X24](./X24-family-export.md).
  - The paste warning between Connections, Family members included: [X25](./X25-cross-connection-paste.md).
  - Mapping differently named Databases across members (ADR 0015: deferred).
  - Sharing anything besides Reference Rules and Row Summaries (saved queries, tabs, Fields lists, column widths).
  - Moving existing per-Connection rules into a Family automatically. They stay local.

## Dependencies

- [X05](./X05-document-references.md): Reference Rules, `reference_rules`, `refs:*`. This spec changes who owns a rule and adds a resolution step in front of every rule read.
- [C05](./C05-connection-manager-shell.md) / [C13](./C13-connection-export-import.md): the Connections table and Connection Export. Connection Export does **not** change: it never carries a Family or its shared configuration.
- [W06](./W06-result-views.md): the Tree view's collapsed row, which reads the Row Summary.
- [ADR 0013](../docs/adr/0013-destructive-friction.md): deleting a Family is type-to-confirm.

## 1. Types

```ts
// shared/types.ts (runtime-free)

export interface ConnectionFamily {
  id: string;            // UUID
  name: string;          // unique, trimmed, 1–80 chars
  memberIds: string[];   // Connection ids, sorted by Connection name via localeCompare
  createdAt: string;
  updatedAt: string;
}

/** Who a stored setting belongs to. Exactly one. */
export type SettingOwner = { connectionId: string } | { familyId: string };

/** How a rule or Row Summary reached the Connection that is reading it. */
export type SettingOrigin = 'local' | 'shared' | 'override';

export interface ReferenceRule {
  id: string;
  owner: SettingOwner;     // replaces the bare `connectionId`
  sourceDb: string; sourceCollection: string; sourceField: string;
  targetDb: string; targetCollection: string; targetField: string;
  projection: string[]; displayTemplate?: string; enabled: boolean;
  createdAt: string; updatedAt: string;
}

/** What a Connection actually uses, after resolution (§4). */
export interface EffectiveReferenceRule extends ReferenceRule {
  origin: SettingOrigin;
  /** On an `override`, the shared rule it replaces. */
  sharedRuleId?: string;
}

export interface RowSummary {
  id: string;
  owner: SettingOwner;
  dbName: string;
  collection: string;
  fields: string[];      // dotted paths, 1–4 entries, no duplicates, never `_id`
  updatedAt: string;
}

export interface EffectiveRowSummary extends RowSummary { origin: SettingOrigin; sharedId?: string }
```

`ConnectionSummary` (the Connections table row) gains `familyId: string | null` and `familyName: string | null`.

## 2. Database — migration 019

Append-only, one new file `019-connection-families.sql`:

- `connection_families (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`.
- `connections.family_id TEXT NULL REFERENCES connection_families(id) ON DELETE SET NULL`.
- `reference_rules` is rebuilt (SQLite can't relax `NOT NULL`): `connection_id` becomes nullable, `family_id TEXT NULL REFERENCES connection_families(id) ON DELETE CASCADE` is added, with `CHECK ((connection_id IS NULL) <> (family_id IS NULL))`. Every existing row keeps its `connection_id`. No table references `reference_rules`, so the rebuild (create the new table, copy, drop, rename) is safe with `foreign_keys` on, the same pattern migration 016 uses. No `reference_rules` column is encrypted, so rows copy through unchanged. Two partial unique indexes replace `uq_reference_rules_source`: `(connection_id, source_db, source_collection, source_field) WHERE connection_id IS NOT NULL` and the same over `family_id`.
- `row_summaries (id, connection_id NULL, family_id NULL, db_name, collection, fields_json, updated_at)`, with the same owner `CHECK`, cascades, and partial unique indexes on `(owner, db_name, collection)`.

An **Override is not stored as such.** It is a Connection-owned row whose key matches a row owned by that Connection's Family. Leaving the Family turns it into a plain local row with no write.

## 3. IPC contract

No channel carries a secret, so nothing is added to `scripts/ipc-secret-allowlist.txt`.

| Channel | Input | Output |
|---|---|---|
| `families:list` | `{}` | `ConnectionFamily[]` |
| `families:create` | `{name, memberIds?}` | `ConnectionFamily` |
| `families:rename` | `{id, name}` | `ConnectionFamily` |
| `families:setMembership` | `{connectionIds, familyId \| null, keepAsLocal?: boolean}` | `ConnectionFamily[]` |
| `families:delete` | `{id, keepAsLocal: boolean}` | `void` |
| `families:overrides` | `{id}` | `{ruleId: string, connectionIds: string[]}[]` and the same for Row Summaries |
| `refs:list` | as X05, plus `effective?: boolean` | `ReferenceRule[]`, or `EffectiveReferenceRule[]` with `effective` |
| `refs:create` | X05 input with `owner` in place of `connectionId` | `ReferenceRule` |
| `refs:override` | `{connectionId, sharedRuleId, patch}` (`patch: {enabled: false}` switches it off) | `ReferenceRule` |
| `refs:resetToShared` | `{id}` (a Connection-owned Override) | `void` |
| `rowSummary:get` | `{connectionId, dbName, collection}` | `EffectiveRowSummary \| null` |
| `rowSummary:set` | `{owner, dbName, collection, fields}` | `RowSummary` |
| `rowSummary:clear` | `{owner, dbName, collection}` | `void` |

Errors: `VALIDATION` (empty or over-long name, Row Summary outside 1–4 fields or containing `_id`, a `refs:override` whose shared rule isn't from the Connection's Family), `CONFLICT` (duplicate Family name, a second rule for the same owner and key), `NOT_FOUND`.

`setMembership` moving a Connection from one Family to another is a leave then a join, in one transaction.

## 4. Resolution

Every rule read goes through one service method, `ReferenceRulesService.effective(connectionId, dbName?, collection?)`. No surface reads `reference_rules` rows directly.

1. Take the Connection's own rows.
2. If the Connection is in a Family, take the Family's rows.
3. A Family row whose `(sourceDb, sourceCollection, sourceField)` matches a Connection row is replaced by it, and the Connection row becomes `origin: 'override'` with `sharedRuleId`. The rest are `'shared'` or `'local'`.
4. A disabled Override hides the shared rule on that Connection and nothing else.

Rows are sorted by `sourceField` via `localeCompare`. Shared rules match by Database and Collection **name**: on a member whose server has no `shop.orders`, a shared `shop.orders` rule does nothing and raises no error.

The Row Summary resolves the same way, keyed by `(dbName, collection)`. With no effective Row Summary, the Tree view keeps today's behaviour: the first visible fields of the tab's Fields list.

## 5. Behaviour

### Creating a setting

In the Reference Rules editor, or the Row Summary picker, on a Connection that belongs to a Family, a new setting is **shared by default**. A **This connection only** choice beside Save makes it local. On a Connection with no Family, there's no choice and it's local.

Editing a shared rule from a member's editor asks **Change for the whole family** or **Override on this connection**. The second creates an Override through `refs:override`.

### Leaving a Family

**Leave family** (row menu or batch) confirms with a **Keep the family's settings on this connection** checkbox, ticked by default. When kept, every shared setting the leaving Connection has no Override for is copied to it as a local setting. Its Overrides become plain local settings either way.

### Deleting a Family

From the Family view, type-to-confirm with the Family name (ADR 0013). The dialog lists the members and offers **Keep the shared settings on every member as local settings**, ticked by default. When kept, the same copying as Leaving runs for each member before the Family's rows cascade away. Members are left with no Family.

### Row Summary

Chosen from the Tree view: a **Row summary…** item in the view's menu opens a picker of the Collection's field paths (from the same field suggestions the Filter Bar uses), with at most 4 fields and a reorder control. Clearing it falls back to today's behaviour. It is independent of the Fields list: it hides no column and changes no projection, and a Fields list change never edits it.

## 6. UI

- **Connections table**: a **Family** column (empty for none). The row menu gets **Add to family…** (pick an existing Family or **New family…**) and **Leave family**. Both are also batch actions on Checked Connections.
- **Family view**: selecting a Family's name in the table opens a panel with:
  - its name (editable) and its members;
  - its shared Reference Rules and Row Summaries, each with the members that override it;
  - **Export…** ([X24](./X24-family-export.md)), **Apply a family export…** ([X24](./X24-family-export.md)) and **Delete family…**.
- **Reference Rules editor**: each rule shows a badge, **Shared**, **Overridden here** or **Local**. An Overridden rule has **Reset to shared**, which deletes the Override through `refs:resetToShared` without a confirm, since the shared rule takes over again at once.
- **Connection Switcher** rows and **Tab Group** headers show the Family name in a muted style after the Connection name. It is read-only, and clicking it does nothing beyond what the row or header already does.
- Every new control is a native button or menu item, reachable by keyboard (X19).

## 7. Error handling

- Deleting a Connection still cascades to its own rows only. Shared rows outlive every member.
- A Family with no members is allowed and kept: it is how an applied Family Export (X24) starts before anyone joins.
- A `CONFLICT` on creating a shared rule (the Family already has one for that key) is shown in the editor as "This family already has a rule for `<field>`", with a link to it.

## 8. Acceptance criteria

- Migration 019 applies to a database that has rules, and every existing rule keeps its Connection as owner.
- A Connection belongs to at most one Family. Joining a second one moves it.
- A shared rule shows its chip on every member whose server has that Database and Collection, and nowhere else.
- An Override replaces the shared rule on its own Connection only. A disabled Override hides the shared rule there only.
- Every rule surface (Tree, Table, hover popover, drawer, editor) shows the same effective set, because all of them read through `effective()`.
- A new rule on a member is shared by default. "This connection only" makes it local.
- The editor badges every rule Shared, Overridden here or Local, and Reset to shared removes the Override.
- The Family view lists, for each shared setting, the members that override it.
- Leaving with "keep" leaves the Connection with the same effective rules it had before leaving. Leaving without "keep" leaves only its own.
- Deleting a Family is type-to-confirm. With "keep", every member's effective rules are unchanged afterwards. Without it, members keep only their own rows.
- A saved Row Summary drives the collapsed Tree row. With none saved, the row behaves exactly as before. Setting one changes no column, projection or Fields list.
- A Connection Export of a member carries no Family and no shared configuration.
- The Family name appears read-only in the Connection Switcher and on Tab Group headers.

## 9. Test cases

### Unit
- `effective-rules.spec.ts`: the resolution in §4 as a pure function. Local only, shared only, an Override, a disabled Override, a shared rule on a Database the member lacks, sorting. A property test checks that every `(db, collection, sourceField)` key appears at most once in the effective set.
- `row-summary-validate.spec.ts`: 1–4 fields, no `_id`, no duplicates.

### Integration
- `connection-families.spec.ts` (real SQLite):
  - migration 019 over a populated `reference_rules`;
  - create, rename, and a duplicate name rejected as `CONFLICT`, case-insensitive;
  - setMembership moves a Connection between Families in one transaction;
  - leave with and without keep;
  - delete with and without keep;
  - Connection delete cascades only its own rows.
- `reference-rules.spec.ts` (extend): owner `CHECK`, both partial unique indexes, `refs:override` rejected across Families, `refs:resetToShared`, `effective` through the IPC handler.
- `connection-export.spec.ts` (extend): an exported member carries no Family data.

### Component
- `reference-rules-editor` (extend): badges, the shared-by-default choice, the edit prompt (whole family vs override), Reset to shared.
- `family-view.spec.tsx`: members, overrides per setting, and Delete as type-to-confirm with the keep checkbox.
- `tree-view` (extend): Row Summary drives the collapsed row, with the fallback unchanged, using a stateful wrapper so the saved value round-trips.

### E2E
- `x23-connection-families.e2e.ts`: two Connections to two `mongodb-memory-server` instances with the same `shop.orders`. Put them in a Family, add a shared rule on one, see its chip on the other, override it there, reset it, and leave with keep.
