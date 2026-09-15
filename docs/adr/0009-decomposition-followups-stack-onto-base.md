# The §9 decomposition follow-ups stack onto the base branch

## Status

accepted

## Context

The base → `main` PR cannot merge before 2026-09-01: the reviewer-bot
gate is `workflow_dispatch`-only and GitHub Actions on this repo is billing-blocked,
so every run dies in ~2s with no runner allocated.

## Decision

Each decomposition follow-up gets its own branch and PR into
`refactor/workspace-decomposition`, stacked oldest-first per
`.claude/skills/feature-base-branch/SKILL.md`. The base branch accumulates them.

## Consequences

Flagged, not solved. The base branch's diff grows well past a reviewable size.
Splitting the base is the alternative and it is the maintainer's call, not an
implementer's — raise it, do not take it.

## Out of scope

The `DbCollectionNavigator` cache / tree-state item was de-scoped by
the maintainer on 2026-08-23 and has since shipped.
It is not re-scoped in by "complete the refactor".
