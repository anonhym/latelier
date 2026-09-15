---
name: aggregation
description: "Skill for the Aggregation area of mongo-lab. 99 symbols across 18 files."
---

# Aggregation

99 symbols | 18 files | Cohesion: 72%

## When to Use

- Working with code in `src/`
- Understanding how removeStage, moveStage, setBody work
- Modifying aggregation-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/pages/Workspace/Aggregation/AggregationTab.tsx` | markDirty, onRemoveStage, onMoveUp, onMoveDown, onReorderStage (+15) |
| `src/pages/Workspace/Aggregation/pipeline.ts` | removeStage, moveStage, setBody, setOp, toggleEnabled (+10) |
| `src/pages/Workspace/Aggregation/StageAccordion.tsx` | validate, onChange, onEditorBlur, onFormat, StageOpPicker (+10) |
| `src/pages/Workspace/Aggregation/OutputPanel.tsx` | OutputPanel, JsonOutput, TreeOutput, getByPath, TableOutput (+9) |
| `src/pages/Workspace/Aggregation/JsonTree.tsx` | TypeBadge, formatLeaf, JsonNodeImpl, JsonNode, JsonTree (+1) |
| `src/pages/Workspace/Aggregation/ExplainDrawer.tsx` | metricChipStyle, ExplainDrawer, onDownload, summary |
| `src/pages/Workspace/Aggregation/SaveAsCollectionModal.tsx` | SaveAsCollectionModal, requestClose, submit, inputStyle |
| `tests/component/aggregation-tab.spec.tsx` | renderStatefulTab, StatefulTab, renderTab |
| `src/pages/Workspace/Aggregation/PipelineOutline.tsx` | fmt, opColor, PipelineOutline |
| `src/pages/Workspace/Aggregation/SavePipelineModal.tsx` | SavePipelineModal, requestClose, submit |

## Entry Points

Start here when exploring this area:

- **`removeStage`** (Function) — `src/pages/Workspace/Aggregation/pipeline.ts:145`
- **`moveStage`** (Function) — `src/pages/Workspace/Aggregation/pipeline.ts:151`
- **`setBody`** (Function) — `src/pages/Workspace/Aggregation/pipeline.ts:162`
- **`setOp`** (Function) — `src/pages/Workspace/Aggregation/pipeline.ts:175`
- **`toggleEnabled`** (Function) — `src/pages/Workspace/Aggregation/pipeline.ts:196`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `removeStage` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 145 |
| `moveStage` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 151 |
| `setBody` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 162 |
| `setOp` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 175 |
| `toggleEnabled` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 196 |
| `markDirty` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 94 |
| `onRemoveStage` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 106 |
| `onMoveUp` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 118 |
| `onMoveDown` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 125 |
| `onReorderStage` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 132 |
| `onSetBody` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 138 |
| `onToggleEnabled` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 144 |
| `onChangeOp` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 150 |
| `useLatest` | Function | `src/commands/useLatest.ts` | 8 |
| `isWriteStage` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 115 |
| `AggregationTab` | Function | `src/pages/Workspace/Aggregation/AggregationTab.tsx` | 48 |
| `ExplainDrawer` | Function | `src/pages/Workspace/Aggregation/ExplainDrawer.tsx` | 64 |
| `onDownload` | Function | `src/pages/Workspace/Aggregation/ExplainDrawer.tsx` | 145 |
| `isKnownOp` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 119 |
| `validateStageBody` | Function | `src/pages/Workspace/Aggregation/pipeline.ts` | 253 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `OnRun → UnsupportedSyntax` | cross_community | 8 |
| `OnEditorBlur → UnsupportedSyntax` | cross_community | 8 |
| `OnEditorBlur → IsExactSentinel` | cross_community | 8 |
| `Validation → UnsupportedSyntax` | cross_community | 8 |
| `Validation → IsExactSentinel` | cross_community | 8 |
| `OnSave → UnsupportedSyntax` | cross_community | 7 |
| `OnRunToStage → UnsupportedSyntax` | cross_community | 7 |
| `OnFormat → UnsupportedSyntax` | cross_community | 7 |
| `OnFormat → IsExactSentinel` | cross_community | 7 |
| `OnRun → DropTrailingComma` | cross_community | 7 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 10 calls |
| Views | 8 calls |
| Component | 7 calls |
| FieldSuggestions | 3 calls |
| Connections | 3 calls |
| Pages | 2 calls |
| References | 2 calls |
| Cluster_210 | 1 calls |

## How to Explore

1. `context({name: "removeStage"})` — see callers and callees
2. `query({search_query: "aggregation"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
