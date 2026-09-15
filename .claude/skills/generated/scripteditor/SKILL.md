---
name: scripteditor
description: "Skill for the ScriptEditor area of mongo-lab. 16 symbols across 4 files."
---

# ScriptEditor

16 symbols | 4 files | Cohesion: 94%

## When to Use

- Working with code in `src/`
- Understanding how detectFieldPosition, mongoCompletionSource, stageBodyCompletionSource work
- Modifying scripteditor-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/components/scriptEditor/fieldPositionDetector.ts` | resolveCollectionFromContext, isNamedNode, firstNamedChild, readKeyText, stripQuotes (+4) |
| `src/components/scriptEditor/stageBodyCompletions.ts` | fieldToCompletion, operatorToCompletion, collectOptions, stageBodyCompletionSource |
| `src/components/scriptEditor/mongoCompletions.ts` | fieldSuggestionsToCompletions, mongoCompletionSource |
| `src/pages/Workspace/Aggregation/StageAccordion.tsx` | buildCompletionSource |

## Entry Points

Start here when exploring this area:

- **`detectFieldPosition`** (Function) — `src/components/scriptEditor/fieldPositionDetector.ts:315`
- **`mongoCompletionSource`** (Function) — `src/components/scriptEditor/mongoCompletions.ts:165`
- **`stageBodyCompletionSource`** (Function) — `src/components/scriptEditor/stageBodyCompletions.ts:125`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `detectFieldPosition` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 315 |
| `mongoCompletionSource` | Function | `src/components/scriptEditor/mongoCompletions.ts` | 165 |
| `stageBodyCompletionSource` | Function | `src/components/scriptEditor/stageBodyCompletions.ts` | 125 |
| `resolveCollectionFromContext` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 102 |
| `isNamedNode` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 165 |
| `firstNamedChild` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 170 |
| `readKeyText` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 176 |
| `stripQuotes` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 187 |
| `indexOfArg` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 198 |
| `parseDbCallee` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 222 |
| `findKeySlot` | Function | `src/components/scriptEditor/fieldPositionDetector.ts` | 246 |
| `fieldSuggestionsToCompletions` | Function | `src/components/scriptEditor/mongoCompletions.ts` | 142 |
| `fieldToCompletion` | Function | `src/components/scriptEditor/stageBodyCompletions.ts` | 36 |
| `operatorToCompletion` | Function | `src/components/scriptEditor/stageBodyCompletions.ts` | 45 |
| `collectOptions` | Function | `src/components/scriptEditor/stageBodyCompletions.ts` | 65 |
| `buildCompletionSource` | Function | `src/pages/Workspace/Aggregation/StageAccordion.tsx` | 512 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `ScriptTabInner → IsNamedNode` | cross_community | 8 |
| `ScriptTabInner → StripQuotes` | cross_community | 8 |
| `ScriptTabInner → ParseDbCallee` | cross_community | 7 |
| `ScriptTabInner → FieldSuggestionsToCompletions` | cross_community | 5 |

## Connected Areas

| Area | Connections |
|------|-------------|
| FieldSuggestions | 1 calls |

## How to Explore

1. `context({name: "detectFieldPosition"})` — see callers and callees
2. `query({search_query: "scripteditor"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
