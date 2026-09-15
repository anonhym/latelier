---
name: commands
description: "Skill for the Commands area of mongo-lab. 23 symbols across 5 files."
---

# Commands

23 symbols | 5 files | Cohesion: 92%

## When to Use

- Working with code in `src/`
- Understanding how openPalette, closePalette, togglePalette work
- Modifying commands-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/commands/CommandPalette.tsx` | open, close, openPalette, closePalette, togglePalette (+10) |
| `src/commands/rank.ts` | isVisible, rankCommands, groupRows |
| `src/commands/registry.ts` | list, subscribe |
| `src/commands/PaletteContext.tsx` | parseConnectionId, value |
| `src/hooks/useRovingHighlight.ts` | useRovingHighlight |

## Entry Points

Start here when exploring this area:

- **`openPalette`** (Function) — `src/commands/CommandPalette.tsx:293`
- **`closePalette`** (Function) — `src/commands/CommandPalette.tsx:298`
- **`togglePalette`** (Function) — `src/commands/CommandPalette.tsx:302`
- **`useRovingHighlight`** (Function) — `src/hooks/useRovingHighlight.ts:34`
- **`rankCommands`** (Function) — `src/commands/rank.ts:38`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `openPalette` | Function | `src/commands/CommandPalette.tsx` | 293 |
| `closePalette` | Function | `src/commands/CommandPalette.tsx` | 298 |
| `togglePalette` | Function | `src/commands/CommandPalette.tsx` | 302 |
| `useRovingHighlight` | Function | `src/hooks/useRovingHighlight.ts` | 34 |
| `rankCommands` | Function | `src/commands/rank.ts` | 38 |
| `recordRecent` | Function | `src/commands/CommandPalette.tsx` | 320 |
| `groupRows` | Function | `src/commands/rank.ts` | 94 |
| `value` | Function | `src/commands/PaletteContext.tsx` | 46 |
| `open` | Function | `src/commands/CommandPalette.tsx` | 55 |
| `close` | Function | `src/commands/CommandPalette.tsx` | 56 |
| `useRegistrySnapshot` | Function | `src/commands/CommandPalette.tsx` | 83 |
| `ActionItem` | Function | `src/commands/CommandPalette.tsx` | 102 |
| `PaletteContent` | Function | `src/commands/CommandPalette.tsx` | 169 |
| `isVisible` | Function | `src/commands/rank.ts` | 21 |
| `ranked` | Function | `src/commands/CommandPalette.tsx` | 174 |
| `perform` | Function | `src/commands/CommandPalette.tsx` | 187 |
| `onKeyDown` | Function | `src/commands/CommandPalette.tsx` | 206 |
| `groups` | Function | `src/commands/CommandPalette.tsx` | 178 |
| `getSnapshot` | Function | `src/commands/CommandPalette.tsx` | 88 |
| `subscribe` | Function | `src/commands/CommandPalette.tsx` | 84 |

## Execution Flows

| Flow | Type | Steps |
|------|------|-------|
| `QueryBarInner → UseRovingHighlight` | cross_community | 4 |
| `PanelBody → UseRovingHighlight` | cross_community | 3 |
| `ShellSection → UseRovingHighlight` | cross_community | 3 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Component | 1 calls |

## How to Explore

1. `context({name: "openPalette"})` — see callers and callees
2. `query({search_query: "commands"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
