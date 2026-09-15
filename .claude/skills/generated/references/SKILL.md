---
name: references
description: "Skill for the References area of mongo-lab. 35 symbols across 10 files."
---

# References

35 symbols | 10 files | Cohesion: 74%

## When to Use

- Working with code in `src/`
- Understanding how renderDisplayTemplate, ReferenceChip, clearHoverTimer work
- Modifying references-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/features/references/ReferenceRulesEditor.tsx` | emptyForm, ruleToForm, parseProjection, ReferenceRulesEditor, openForm (+7) |
| `src/features/references/ReferenceDrawer.tsx` | ReferenceDrawer, BreadcrumbTrail, DocList, fallbackLabel, DocFields (+2) |
| `src/features/references/ReferenceChip.tsx` | ReferenceChip, clearHoverTimer, handleEnter, handleLeave |
| `src/features/references/display.ts` | renderDisplayTemplate, makeFrameId, isSameReferenceTarget |
| `src/pages/Workspace/views/DocFieldTree.tsx` | TypeBadge, FieldNodeImpl |
| `src/pages/Workspace/views/TreeView.tsx` | truncatePreviewValue, CollapsedRowPreview |
| `tests/component/reference-rules-editor-dialog-shell.spec.tsx` | renderEditor, Harness |
| `src/features/references/ReferenceHoverPopover.tsx` | ReferenceHoverPopover |
| `src/utils/displayValue.ts` | toDisplayValue |
| `src/pages/Workspace/useReferenceDrawer.ts` | handleRefOpen |

## Entry Points

Start here when exploring this area:

- **`renderDisplayTemplate`** (Function) — `src/features/references/display.ts:26`
- **`ReferenceChip`** (Function) — `src/features/references/ReferenceChip.tsx:16`
- **`clearHoverTimer`** (Function) — `src/features/references/ReferenceChip.tsx:21`
- **`handleEnter`** (Function) — `src/features/references/ReferenceChip.tsx:30`
- **`handleLeave`** (Function) — `src/features/references/ReferenceChip.tsx:39`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `renderDisplayTemplate` | Function | `src/features/references/display.ts` | 26 |
| `ReferenceChip` | Function | `src/features/references/ReferenceChip.tsx` | 16 |
| `clearHoverTimer` | Function | `src/features/references/ReferenceChip.tsx` | 21 |
| `handleEnter` | Function | `src/features/references/ReferenceChip.tsx` | 30 |
| `handleLeave` | Function | `src/features/references/ReferenceChip.tsx` | 39 |
| `ReferenceDrawer` | Function | `src/features/references/ReferenceDrawer.tsx` | 35 |
| `ReferenceHoverPopover` | Function | `src/features/references/ReferenceHoverPopover.tsx` | 15 |
| `toDisplayValue` | Function | `src/utils/displayValue.ts` | 65 |
| `TypeBadge` | Function | `src/pages/Workspace/views/DocFieldTree.tsx` | 42 |
| `ReferenceRulesEditor` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 70 |
| `openForm` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 91 |
| `closeForm` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 95 |
| `requestClose` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 118 |
| `loadRules` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 128 |
| `refresh` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 147 |
| `handleSave` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 152 |
| `handleDelete` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 196 |
| `applyCandidate` | Function | `src/features/references/ReferenceRulesEditor.tsx` | 229 |
| `makeFrameId` | Function | `src/features/references/display.ts` | 4 |
| `isSameReferenceTarget` | Function | `src/features/references/display.ts` | 12 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `DialogStack → IsRecord` | cross_community | 4 |
| `DialogStack → IsIpcError` | cross_community | 4 |
| `DialogStack → ConfirmDestructive` | cross_community | 4 |
| `HandleDrop → IsRecord` | cross_community | 4 |
| `HandleCopyField → IsRecord` | cross_community | 4 |
| `DocRowImpl → IsRecord` | cross_community | 4 |
| `HandleCopy → IsRecord` | cross_community | 4 |
| `HandleSave → IsIpcError` | cross_community | 4 |
| `TableCell → IsRecord` | cross_community | 4 |
| `HandleListPick → IsRecord` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Views | 6 calls |
| Workspace | 5 calls |
| Connections | 4 calls |
| Component | 1 calls |
| FieldSuggestions | 1 calls |

## How to Explore

1. `context({name: "renderDisplayTemplate"})` — see callers and callees
2. `query({search_query: "references"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
