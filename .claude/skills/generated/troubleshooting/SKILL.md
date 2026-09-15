---
name: troubleshooting
description: "Skill for the Troubleshooting area of mongo-lab. 8 symbols across 5 files."
---

# Troubleshooting

8 symbols | 5 files | Cohesion: 88%

## When to Use

- Working with code in `src/`
- Understanding how parseInline, flushText, match work
- Modifying troubleshooting-related functionality

## Key Files

| File | Symbols |
|------|---------|
| `src/troubleshooting/parseInline.ts` | parseInline, flushText |
| `src/troubleshooting/recipes.ts` | match, pickRecipe |
| `src/troubleshooting/TroubleshootingDrawer.tsx` | TroubleshootingDrawer, runAction |
| `src/troubleshooting/repoUrl.ts` | docUrlFor |
| `src/troubleshooting/markdown.tsx` | InlineMarkdown |

## Entry Points

Start here when exploring this area:

- **`parseInline`** (Function) — `src/troubleshooting/parseInline.ts:16`
- **`flushText`** (Function) — `src/troubleshooting/parseInline.ts:20`
- **`match`** (Function) — `src/troubleshooting/recipes.ts:20`
- **`pickRecipe`** (Function) — `src/troubleshooting/recipes.ts:234`
- **`docUrlFor`** (Function) — `src/troubleshooting/repoUrl.ts:7`

## Key Symbols

| Symbol | Type | File | Line |
|--------|------|------|------|
| `parseInline` | Function | `src/troubleshooting/parseInline.ts` | 16 |
| `flushText` | Function | `src/troubleshooting/parseInline.ts` | 20 |
| `match` | Function | `src/troubleshooting/recipes.ts` | 20 |
| `pickRecipe` | Function | `src/troubleshooting/recipes.ts` | 234 |
| `docUrlFor` | Function | `src/troubleshooting/repoUrl.ts` | 7 |
| `TroubleshootingDrawer` | Function | `src/troubleshooting/TroubleshootingDrawer.tsx` | 15 |
| `runAction` | Function | `src/troubleshooting/TroubleshootingDrawer.tsx` | 32 |
| `InlineMarkdown` | Function | `src/troubleshooting/markdown.tsx` | 12 |

## Connected Areas

| Area | Connections |
|------|-------------|
| Workspace | 1 calls |

## How to Explore

1. `context({name: "parseInline"})` — see callers and callees
2. `query({search_query: "troubleshooting"})` — find related execution flows
3. Read key files listed above for implementation details
4. `explain({target: "<file or symbol>"})` — persisted taint findings (source→sink data flows), when indexed with `--pdg`
