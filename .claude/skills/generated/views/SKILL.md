---
name: views
description: "Skill for the Views area of mongo-lab. 76 symbols across 25 files."
---

# Views

76 symbols | 25 files | Cohesion: 71%

## When to Use

- Working with code in `src/`
- Understanding how rootEntries, derived, getDocId work
- Modifying views-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/pages/Workspace/views/TableView.tsx` | TableRowImpl, TableRow, derivedFields, copyCell, handleCopyField (+9) |
| `src/pages/Workspace/views/JsonView.tsx` | copyDoc, buildJsonTree, parseNodes, tree, HighlightedJson (+7) |
| `src/pages/Workspace/views/RecentTab.tsx` | previewOf, RecentTab, load, runDelete, requestDelete (+1) |
| `src/pages/Workspace/views/TreeView.tsx` | getPreviewFields, preview, DocRowImpl, DocRow, handleCopy |
| `src/utils/jsonHighlight.ts` | tokenizeJson, peek, readString, readNumber, readLiteral |
| `src/pages/Workspace/views/tableColumns.ts` | deriveColumns, getValueAtPath, orderFields, resolveColumns |
| `src/pages/Workspace/views/docId.ts` | getDocId, getFullDocId, isInlineEditable |
| `src/utils/displayValue.ts` | isRecord, valueToClipboardText, docKey |
| `src/utils/explainSummary.ts` | nextStage, collectStageChain, findIndexInfo |
| `src/pages/Workspace/views/DocFieldTree.tsx` | childEntries, FieldNode, DocFieldTree |

## Entry Points

Start here when exploring this area:

- **`rootEntries`** (Function) — `src/pages/Workspace/Aggregation/JsonTree.tsx:229`
- **`derived`** (Function) — `src/pages/Workspace/ColumnChooser.tsx:25`
- **`getDocId`** (Function) — `src/pages/Workspace/views/docId.ts:14`
- **`getFullDocId`** (Function) — `src/pages/Workspace/views/docId.ts:34`
- **`isInlineEditable`** (Function) — `src/pages/Workspace/views/docId.ts:86`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `rootEntries` | Function | `src/pages/Workspace/Aggregation/JsonTree.tsx` | 229 |
| `derived` | Function | `src/pages/Workspace/ColumnChooser.tsx` | 25 |
| `getDocId` | Function | `src/pages/Workspace/views/docId.ts` | 14 |
| `getFullDocId` | Function | `src/pages/Workspace/views/docId.ts` | 34 |
| `isInlineEditable` | Function | `src/pages/Workspace/views/docId.ts` | 86 |
| `deriveColumns` | Function | `src/pages/Workspace/views/tableColumns.ts` | 9 |
| `getValueAtPath` | Function | `src/pages/Workspace/views/tableColumns.ts` | 130 |
| `isRecord` | Function | `src/utils/displayValue.ts` | 21 |
| `FieldNode` | Function | `src/pages/Workspace/views/DocFieldTree.tsx` | 297 |
| `DocFieldTree` | Function | `src/pages/Workspace/views/DocFieldTree.tsx` | 368 |
| `derivedFields` | Function | `src/pages/Workspace/views/TableView.tsx` | 807 |
| `requestClose` | Function | `src/pages/Workspace/EditDrawer.tsx` | 69 |
| `emptyBuilder` | Function | `src/pages/Workspace/builder.ts` | 382 |
| `confirmDestructive` | Function | `src/utils/confirm.ts` | 34 |
| `RecentTab` | Function | `src/pages/Workspace/views/RecentTab.tsx` | 29 |
| `load` | Function | `src/pages/Workspace/views/RecentTab.tsx` | 43 |
| `runDelete` | Function | `src/pages/Workspace/views/RecentTab.tsx` | 65 |
| `requestDelete` | Function | `src/pages/Workspace/views/RecentTab.tsx` | 80 |
| `requestClear` | Function | `src/pages/Workspace/views/RecentTab.tsx` | 101 |
| `onCopy` | Function | `src/pages/Workspace/Aggregation/ExplainDrawer.tsx` | 140 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `Body → Success` | cross_community | 5 |
| `Body → Error` | cross_community | 5 |
| `StageRow → BrightenBadgeForDark` | cross_community | 5 |
| `RecentTab → GetErrorMessage` | cross_community | 5 |
| `Summary → IsRecord` | cross_community | 5 |
| `DialogStack → IsRecord` | cross_community | 4 |
| `DialogStack → ConfirmDestructive` | cross_community | 4 |
| `HandleDrop → IsRecord` | cross_community | 4 |
| `HandleCopyField → IsRecord` | cross_community | 4 |
| `DocRowImpl → IsRecord` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 12 calls |
| Aggregation | 5 calls |
| References | 4 calls |
| Component | 2 calls |
| Pages | 1 calls |
| Connections | 1 calls |
| FieldSuggestions | 1 calls |

## How to Explore

1. `context({name: "rootEntries"})` — see callers and callees
2. `query({search_query: "views"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
