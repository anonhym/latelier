---
name: fieldsuggestions
description: "Skill for the FieldSuggestions area of mongo-lab. 45 symbols across 14 files."
---

# FieldSuggestions

45 symbols | 14 files | Cohesion: 78%

## When to Use

- Working with code in `src/`
- Understanding how detectAggGrammar, getCaretRect, probe work
- Modifying fieldsuggestions-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/features/fieldSuggestions/OperatorTooltip.tsx` | OperatorTooltip, op, doOpen, startOpen, onMouseEnter (+6) |
| `src/features/fieldSuggestions/SuggestionPopover.tsx` | labelFor, nameFor, badgeFor, SuggestionPopover, update (+1) |
| `src/features/fieldSuggestions/useSuggestions.ts` | useSuggestions, scoreMatch, rankField, rankValue, rankOperator (+1) |
| `src/features/fieldSuggestions/FieldAutocompleteInput.tsx` | FieldAutocompleteInput, syncCaret, computeToken, tokenInfo |
| `src/features/fieldSuggestions/placement.ts` | opposite, placeFor, fits, placeFloatingPanel |
| `src/features/fieldSuggestions/aggGrammar.ts` | resolveOperatorContext, detectAggGrammar |
| `src/features/fieldSuggestions/useTextareaAutocomplete.tsx` | probe, useTextareaAutocomplete |
| `tests/unit/field-suggestions-agg-grammar.spec.ts` | fx, hit |
| `src/features/fieldSuggestions/OperatorDocPanel.tsx` | openDocsUrl, OperatorDocPanel |
| `src/features/fieldSuggestions/operators.ts` | findOperatorDocs, hasOperatorDocs |

## Entry Points

Start here when exploring this area:

- **`detectAggGrammar`** (Function) — `src/features/fieldSuggestions/aggGrammar.ts:50`
- **`getCaretRect`** (Function) — `src/features/fieldSuggestions/caretPosition.ts:8`
- **`probe`** (Function) — `src/features/fieldSuggestions/useTextareaAutocomplete.tsx:48`
- **`SuggestionPopover`** (Function) — `src/features/fieldSuggestions/SuggestionPopover.tsx:46`
- **`update`** (Function) — `src/features/fieldSuggestions/SuggestionPopover.tsx:84`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `detectAggGrammar` | Function | `src/features/fieldSuggestions/aggGrammar.ts` | 50 |
| `getCaretRect` | Function | `src/features/fieldSuggestions/caretPosition.ts` | 8 |
| `probe` | Function | `src/features/fieldSuggestions/useTextareaAutocomplete.tsx` | 48 |
| `SuggestionPopover` | Function | `src/features/fieldSuggestions/SuggestionPopover.tsx` | 46 |
| `update` | Function | `src/features/fieldSuggestions/SuggestionPopover.tsx` | 84 |
| `FieldAutocompleteInput` | Function | `src/features/fieldSuggestions/FieldAutocompleteInput.tsx` | 119 |
| `syncCaret` | Function | `src/features/fieldSuggestions/FieldAutocompleteInput.tsx` | 153 |
| `useSuggestions` | Function | `src/features/fieldSuggestions/useSuggestions.ts` | 66 |
| `useTextareaAutocomplete` | Function | `src/features/fieldSuggestions/useTextareaAutocomplete.tsx` | 31 |
| `items` | Function | `src/features/fieldSuggestions/useSuggestions.ts` | 147 |
| `useIsDark` | Function | `src/ThemeContext.tsx` | 9 |
| `OperatorDocPanel` | Function | `src/features/fieldSuggestions/OperatorDocPanel.tsx` | 27 |
| `OperatorTooltip` | Function | `src/features/fieldSuggestions/OperatorTooltip.tsx` | 25 |
| `op` | Function | `src/features/fieldSuggestions/OperatorTooltip.tsx` | 33 |
| `docOp` | Function | `src/features/fieldSuggestions/SuggestionPopover.tsx` | 130 |
| `findOperatorDocs` | Function | `src/features/fieldSuggestions/operators.ts` | 2243 |
| `hasOperatorDocs` | Function | `src/features/fieldSuggestions/operators.ts` | 2258 |
| `doOpen` | Function | `src/features/fieldSuggestions/OperatorTooltip.tsx` | 50 |
| `startOpen` | Function | `src/features/fieldSuggestions/OperatorTooltip.tsx` | 63 |
| `onMouseEnter` | Function | `src/features/fieldSuggestions/OperatorTooltip.tsx` | 109 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `QueryBarInner → Opposite` | cross_community | 5 |
| `QueryBarInner → PlaceFor` | cross_community | 5 |
| `QueryBarInner → Fits` | cross_community | 5 |
| `StageRow → BrightenBadgeForDark` | cross_community | 5 |
| `QueryBarInner → UseRovingHighlight` | cross_community | 4 |
| `QueryBarInner → Update` | cross_community | 4 |
| `QueryBarInner → LabelFor` | cross_community | 4 |
| `StageRow → Opposite` | cross_community | 4 |
| `StageRow → PlaceFor` | cross_community | 4 |
| `StageRow → Fits` | cross_community | 4 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Commands | 1 calls |
| Aggregation | 1 calls |

## How to Explore

1. `context({name: "detectAggGrammar"})` — see callers and callees
2. `query({search_query: "fieldsuggestions"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
