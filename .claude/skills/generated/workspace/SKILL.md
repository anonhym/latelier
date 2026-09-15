---
name: workspace
description: "Skill for the Workspace area of mongo-lab. 377 symbols across 101 files."
---

# Workspace

377 symbols | 101 files | Cohesion: 66%

## When to Use

- Working with code in `src/`
- Understanding how sortProblem, findProblem, filterProblem work
- Modifying workspace-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/pages/Workspace/BuilderPane.tsx` | BuilderPaneInner, setActiveTab, seedTree, FilterDrawer, handleCopyCode (+37) |
| `src/pages/Workspace/filterTree.ts` | parseFilter, printFilter, insertNodeAt, insertAt, isUnsafeNumber (+31) |
| `src/pages/Workspace/DbCollectionNavigator.tsx` | dbExpanded, loadColls, off, toggleDb, refreshDb (+29) |
| `src/pages/Workspace/builder.ts` | sortProblem, findProblem, filterProblem, isDefaultQueryState, valTypeFromDisplayType (+15) |
| `src/pages/Workspace/QueryBar.tsx` | Notice, QueryBarInner, sortError, repairQueryRaw, handleBlur (+12) |
| `src/pages/Workspace/useDocumentDialogs.ts` | openDeleteAllModal, targetOf, openEdit, openInsertModal, openDuplicate (+8) |
| `src/pages/Workspace/ScriptTab.tsx` | ScriptTabInner, ScriptResultPanel, onColumnResize, onRowExpand, ResultValueView (+6) |
| `src/pages/Workspace/useConnectionDialogs.ts` | useConnectionDialogs, closeConnectionTable, closeTableThen, connectFromExpandedTable, manageFromExpandedTable (+3) |
| `src/pages/Workspace/legacyBuilder.ts` | buildCondObject, legacyCompileFilter, parseJsonArray, buildTypedValue, isEjsonWrapped (+2) |
| `src/pages/Workspace/SchemaView.tsx` | SchemaView, runSample, SchemaRow, cellHead, cellBody (+2) |

## Entry Points

Start here when exploring this area:

- **`sortProblem`** (Function) — `src/pages/Workspace/builder.ts:164`
- **`findProblem`** (Function) — `src/pages/Workspace/builder.ts:232`
- **`filterProblem`** (Function) — `src/pages/Workspace/builder.ts:240`
- **`parseProjection`** (Function) — `src/pages/Workspace/projection.ts:29`
- **`isRawProjection`** (Function) — `src/pages/Workspace/projection.ts:80`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `sortProblem` | Function | `src/pages/Workspace/builder.ts` | 164 |
| `findProblem` | Function | `src/pages/Workspace/builder.ts` | 232 |
| `filterProblem` | Function | `src/pages/Workspace/builder.ts` | 240 |
| `parseProjection` | Function | `src/pages/Workspace/projection.ts` | 29 |
| `isRawProjection` | Function | `src/pages/Workspace/projection.ts` | 80 |
| `isValidEjson` | Function | `src/utils/ejson.ts` | 195 |
| `repairToCanonicalEjson` | Function | `src/utils/shellSyntax.ts` | 72 |
| `repairOnCommit` | Function | `src/utils/shellSyntax.ts` | 135 |
| `refusalMessage` | Function | `src/utils/shellSyntax.ts` | 164 |
| `QueryExpandModal` | Function | `src/pages/Workspace/QueryExpandModal.tsx` | 31 |
| `apply` | Function | `src/pages/Workspace/QueryExpandModal.tsx` | 36 |
| `useCollectionWorkspace` | Function | `src/pages/Workspace/context.ts` | 94 |
| `useRowSelection` | Function | `src/pages/Workspace/resultSelection.ts` | 42 |
| `useResultSelection` | Function | `src/pages/Workspace/resultSelection.ts` | 89 |
| `sortedIndices` | Function | `src/pages/Workspace/selection.ts` | 11 |
| `selectedDocs` | Function | `src/pages/Workspace/selection.ts` | 21 |
| `ResultSelectionProvider` | Function | `src/pages/Workspace/ResultSelectionProvider.tsx` | 20 |
| `SelectionActionBar` | Function | `src/pages/Workspace/SelectionActionBar.tsx` | 30 |
| `JsonView` | Function | `src/pages/Workspace/views/JsonView.tsx` | 335 |
| `TableView` | Function | `src/pages/Workspace/views/TableView.tsx` | 672 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleCopyCode → IsExactSentinel` | cross_community | 8 |
| `OnRun → UnsupportedSyntax` | cross_community | 8 |
| `OnEditorBlur → UnsupportedSyntax` | cross_community | 8 |
| `OnEditorBlur → IsExactSentinel` | cross_community | 8 |
| `ScriptTabInner → IsNamedNode` | cross_community | 8 |
| `ScriptTabInner → StripQuotes` | cross_community | 8 |
| `ResultBar → IsExactSentinel` | cross_community | 8 |
| `Validation → UnsupportedSyntax` | cross_community | 8 |
| `Validation → IsExactSentinel` | cross_community | 8 |
| `OnSave → UnsupportedSyntax` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Connections | 26 calls |
| Views | 21 calls |
| Component | 17 calls |
| Unit | 8 calls |
| FieldSuggestions | 7 calls |
| Aggregation | 5 calls |
| References | 4 calls |
| Hints | 3 calls |

## How to Explore

1. `context({name: "sortProblem"})` — see callers and callees
2. `query({search_query: "workspace"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
