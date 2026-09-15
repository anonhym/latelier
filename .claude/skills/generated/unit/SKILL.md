---
name: unit
description: "Skill for the Unit area of mongo-lab. 15 symbols across 7 files."
---

# Unit

15 symbols | 7 files | Cohesion: 73%

## When to Use

- Working with code in `tests/`
- Understanding how useReferenceDrawer, ejsonParse work
- Modifying unit-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `tests/unit/shell-syntax.spec.ts` | mustRepair, mustFail, describeOutcome, value |
| `tests/unit/ejson-readable.spec.ts` | readable, canonical, roundTrips |
| `tests/unit/uri-parse.property.spec.ts` | caseVariant, droppedKeyVariantArb, mechVariantArb |
| `tests/unit/field-suggestions-source.spec.ts` | sync, fieldsOf |
| `src/pages/Workspace/useReferenceDrawer.ts` | useReferenceDrawer |
| `src/utils/ejson.ts` | ejsonParse |
| `tests/unit/deleteMode.spec.ts` | docWithId |

## Entry Points

Start here when exploring this area:

- **`useReferenceDrawer`** (Function) — `src/pages/Workspace/useReferenceDrawer.ts:32`
- **`ejsonParse`** (Function) — `src/utils/ejson.ts:56`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `useReferenceDrawer` | Function | `src/pages/Workspace/useReferenceDrawer.ts` | 32 |
| `ejsonParse` | Function | `src/utils/ejson.ts` | 56 |
| `docWithId` | Function | `tests/unit/deleteMode.spec.ts` | 8 |
| `readable` | Function | `tests/unit/ejson-readable.spec.ts` | 9 |
| `canonical` | Function | `tests/unit/ejson-readable.spec.ts` | 19 |
| `roundTrips` | Function | `tests/unit/ejson-readable.spec.ts` | 24 |
| `mustRepair` | Function | `tests/unit/shell-syntax.spec.ts` | 7 |
| `mustFail` | Function | `tests/unit/shell-syntax.spec.ts` | 13 |
| `describeOutcome` | Function | `tests/unit/shell-syntax.spec.ts` | 19 |
| `value` | Function | `tests/unit/shell-syntax.spec.ts` | 24 |
| `caseVariant` | Function | `tests/unit/uri-parse.property.spec.ts` | 9 |
| `droppedKeyVariantArb` | Function | `tests/unit/uri-parse.property.spec.ts` | 70 |
| `mechVariantArb` | Function | `tests/unit/uri-parse.property.spec.ts` | 92 |
| `sync` | Function | `tests/unit/field-suggestions-source.spec.ts` | 11 |
| `fieldsOf` | Function | `tests/unit/field-suggestions-source.spec.ts` | 18 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `HandleCopyCode → IsExactSentinel` | cross_community | 8 |
| `OnEditorBlur → IsExactSentinel` | cross_community | 8 |
| `ResultBar → IsExactSentinel` | cross_community | 8 |
| `Validation → IsExactSentinel` | cross_community | 8 |
| `Body → IsExactSentinel` | cross_community | 7 |
| `OnFormat → IsExactSentinel` | cross_community | 7 |
| `HandleKeyDown → IsExactSentinel` | cross_community | 7 |
| `Run → IsExactSentinel` | cross_community | 6 |
| `CurrentQueryKey → IsExactSentinel` | cross_community | 6 |
| `OpenDeleteAllModal → IsExactSentinel` | cross_community | 6 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 4 calls |
| Aggregation | 1 calls |
| Cluster_210 | 1 calls |

## How to Explore

1. `context({name: "useReferenceDrawer"})` — see callers and callees
2. `query({search_query: "unit"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
