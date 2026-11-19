# X24 — Family Export

> **Status: Implemented.** The decisions behind this spec are in [ADR 0015](../docs/adr/0015-connection-families.md).

## Purpose

Let a Connection Family's shared configuration be written to a file and **Applied** to any Family: one of the user's own, or a teammate's after they receive the file. A **Family Export** carries Reference Rules and Row Summaries and nothing else. It is separate from Connection Export, which still carries Connections only. Terms are as defined in `CONTEXT.md`.

## Scope

- **In**:
  - Writing a Family Export from the Family view.
  - Reading one and Applying it to an existing Family or a new one, with a conflict prompt and a summary afterwards.
  - The versioned, validated file format.
- **Out**:
  - Exporting part of a Family (chosen Collections or rules).
  - Applying to a Connection that is not in a Family. Make a Family of one instead.
  - Carrying Connections, members, Overrides, local settings or secrets. Connection Export is unchanged ([C13](./C13-connection-export-import.md)).
  - Any merge strategy other than "add new, ask on conflict, never delete".

## Dependencies

- [X23](./X23-connection-families.md): Families, shared Reference Rules and Row Summaries, Overrides, the Family view.
- [C13](./C13-connection-export-import.md): the save/open dialog pattern in main, and the refusal of files it doesn't recognise.

## 1. File format

A UTF-8 JSON file, `<family name>.latelier-family.json`:

```jsonc
{
  "format": "latelier-family-export",   // distinguishes it from a Connection Export
  "version": 1,
  "exportedAt": "2026-11-18T12:00:00.000Z",
  "familyName": "Client deployments",    // a suggestion only (§3)
  "referenceRules": [
    { "sourceDb": "shop", "sourceCollection": "orders", "sourceField": "customerId",
      "targetDb": "shop", "targetCollection": "customers", "targetField": "_id",
      "projection": ["name", "email"], "displayTemplate": "{name}", "enabled": true }
  ],
  "rowSummaries": [
    { "dbName": "shop", "collection": "orders", "fields": ["status", "total"] }
  ]
}
```

- It has no ids and no timestamps per item. Items are keyed by their natural key: `(sourceDb, sourceCollection, sourceField)` for a rule, and `(dbName, collection)` for a Row Summary.
- It never contains Connection ids, names or URIs, so there's nothing secret and no passphrase.
- Main validates it with zod on read. It refuses:
  - a `format` other than `latelier-family-export`, naming what it is when it recognises it ("This is a Connection Export. Use Import in the Connections table.");
  - a `version` it doesn't know;
  - duplicate keys;
  - a Row Summary outside X23's limits;
  - a file over 5 MB.

## 2. IPC contract

No secrets travel, so nothing is added to `scripts/ipc-secret-allowlist.txt`.

| Channel | Input | Output |
|---|---|---|
| `families:export` | `{familyId}` | `{saved: false} \| {saved: true, path, ruleCount, rowSummaryCount}`. Main shows the save dialog and writes the file. |
| `families:readExport` | `{}` | `{cancelled: true} \| {token, familyName, ruleCount, rowSummaryCount}`. Main shows the open dialog, validates the file, and holds the parsed content under a short-lived `token`. |
| `families:planApply` | `{token, target: {familyId} \| {newName}}` | `ApplyPlan` |
| `families:apply` | `{token, target, resolutions: Record<itemKey, 'keep' \| 'take'>}` | `ApplyResult` |

```ts
/** One setting as the dialog shows it; `key` is its natural key, prefixed `rule:` or `summary:`. */
interface FamilyExportItem { key: string; kind: 'rule' | 'rowSummary'; dbName: string; collection: string; field?: string; detail: string }
interface ApplyPlan {
  added: FamilyExportItem[];       // not in the target: will be added
  unchanged: FamilyExportItem[];   // identical in the target: nothing to do
  conflicts: { key: string; current: FamilyExportItem; incoming: FamilyExportItem }[];
}
interface ApplyResult {
  familyId: string;
  added: number; replaced: number; kept: number; unchanged: number;
  /** Members whose Override hides something this Apply added or replaced. */
  overriddenBy: { connectionId: string; keys: string[]; items: FamilyExportItem[] }[];
}
```

`apply` refuses with `VALIDATION` unless every conflict in the plan has a resolution. If the target changed after `planApply` and a new conflict appears, it refuses with `CONFLICT` and the renderer plans again. It runs in one transaction. The token is dropped after `apply` or after 10 minutes.

## 3. Behaviour

### Export

**Export…** in the Family view writes every shared rule and Row Summary of that Family. A Family with nothing shared exports an empty file, with a note in the dialog that it's empty.

### Apply

**Apply a family export…** is available in the Family view (target preset to that Family) and in the Connections table toolbar (no target yet). It runs in four steps:

1. **Open**: pick the file. A refused file shows its reason, and nothing changes.
2. **Target**: pick any existing Family, or **New family from this file**, which proposes the file's `familyName`, made unique (`Client deployments (2)`) if it's taken. The name in the file never picks an existing Family by itself.
3. **Conflicts**: shown only if the plan has any. Each one shows the current and incoming setting side by side, with **Keep current** / **Take the file's**, and an **Apply this choice to all remaining** control.
4. **Summary**: counts for added, replaced, kept and unchanged. If any member has an Override that hides something just added or replaced, it lists those members with a link to each one's Reference Rules editor, so the user can **Reset to shared** if they want.

Applying never deletes anything from the target, and never touches a member's Overrides or local settings. Applying the same file twice is a no-op the second time: everything comes back unchanged.

## 4. Error handling

- A dialog cancelled at any step changes nothing.
- A target Family deleted between steps fails as `NOT_FOUND`, and the dialog returns to the Target step.
- A write failure rolls the transaction back, and the error shows in the dialog. Nothing is half-applied.

## 5. Acceptance criteria

- Export writes a file holding exactly the Family's shared rules and Row Summaries, with no Connection data in it.
- Reading a Connection Export, a file of an unknown version, or malformed JSON is refused with a reason, and nothing changes.
- Apply works on any existing Family, whatever its name, and on a new Family named from the file and made unique.
- New items are added. Identical items are left alone. Every differing item asks Keep current or Take the file's, and "apply to all remaining" answers the rest.
- Apply deletes nothing and leaves every member's Overrides and local settings as they were.
- The summary lists the members whose Override hides something the Apply brought in.
- Applying the same file twice changes nothing the second time.
- Connection Export output is byte-for-byte what it was before this feature, apart from `exportedAt`.

## 6. Test cases

### Unit
- `family-export-format.spec.ts`: zod round-trip; refusals for a Connection Export, an unknown version, duplicate keys, an invalid Row Summary, and oversize. A property test checks that `parse(write(family))` recovers the Family's shared settings.
- `apply-plan.spec.ts`: plan classification (added, unchanged, conflict) as a pure function, keyed by natural key. A property test checks that applying a plan with every conflict resolved to `take` makes the target contain every item in the file.

### Integration
- `family-export.spec.ts` (real SQLite):
  - export, then apply to a second Family;
  - apply as a new Family with a taken name;
  - mixed keep and take resolutions;
  - an unresolved conflict is refused;
  - the target changing between plan and apply gives `CONFLICT`;
  - Overrides untouched and reported in `overriddenBy`;
  - a second apply is a no-op;
  - rollback on a forced write failure.

### Component
- `apply-family-export.spec.tsx`: the four steps, the refusal message, the conflict list with apply-to-all, and the summary with override links.

### E2E
- `x24-family-export.e2e.ts`: export a Family with a rule and a Row Summary, apply it to a second Family whose member has an Override, and check the summary and the chips.
