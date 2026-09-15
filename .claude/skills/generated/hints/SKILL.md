---
name: hints
description: "Skill for the Hints area of mongo-lab. 14 symbols across 9 files."
---

# Hints

14 symbols | 9 files | Cohesion: 79%

## When to Use

- Working with code in `src/`
- Understanding how CommandPalette, registerApi, useHints work
- Modifying hints-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/hints/storage.ts` | getDismissedHints, dismissHint, resetHints |
| `src/hints/HintsProvider.tsx` | HintsProvider, dismiss, reset |
| `src/commands/CommandPalette.tsx` | CommandPalette, registerApi |
| `src/hints/HintsContext.ts` | useHints |
| `src/hints/useFeatureHint.ts` | useFeatureHint |
| `src/hints/FeatureHint.tsx` | FeatureHint |
| `src/pages/SettingsContext.tsx` | SettingsProvider |
| `src/pages/SettingsModal.tsx` | SettingsModal |
| `tests/component/feature-hint.spec.tsx` | Probe |

## Entry Points

Start here when exploring this area:

- **`CommandPalette`** (Function) — `src/commands/CommandPalette.tsx:285`
- **`registerApi`** (Function) — `src/commands/CommandPalette.tsx:371`
- **`useHints`** (Function) — `src/hints/HintsContext.ts:34`
- **`useFeatureHint`** (Function) — `src/hints/useFeatureHint.ts:16`
- **`FeatureHint`** (Function) — `src/hints/FeatureHint.tsx:22`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `CommandPalette` | Function | `src/commands/CommandPalette.tsx` | 285 |
| `registerApi` | Function | `src/commands/CommandPalette.tsx` | 371 |
| `useHints` | Function | `src/hints/HintsContext.ts` | 34 |
| `useFeatureHint` | Function | `src/hints/useFeatureHint.ts` | 16 |
| `FeatureHint` | Function | `src/hints/FeatureHint.tsx` | 22 |
| `SettingsProvider` | Function | `src/pages/SettingsContext.tsx` | 18 |
| `SettingsModal` | Function | `src/pages/SettingsModal.tsx` | 11 |
| `getDismissedHints` | Function | `src/hints/storage.ts` | 5 |
| `dismissHint` | Function | `src/hints/storage.ts` | 10 |
| `HintsProvider` | Function | `src/hints/HintsProvider.tsx` | 12 |
| `dismiss` | Function | `src/hints/HintsProvider.tsx` | 53 |
| `resetHints` | Function | `src/hints/storage.ts` | 19 |
| `reset` | Function | `src/hints/HintsProvider.tsx` | 65 |
| `Probe` | Function | `tests/component/feature-hint.spec.tsx` | 88 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 1 calls |
| Commands | 1 calls |

## How to Explore

1. `context({name: "CommandPalette"})` — see callers and callees
2. `query({search_query: "hints"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
