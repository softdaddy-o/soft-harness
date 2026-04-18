---
name: organize
description: Organize current host settings and prompts using natural-language requests such as remembering a rule, showing the current state, sharing an MCP with another host, splitting host-specific settings, or cleaning up stale prompt, memory, skill, agent, or plugin entries. Use when the user wants to change real Claude Code or Codex state and keep `.harness` in sync as a snapshot plus decision memory. Respect `--dry-run` by planning only and not writing files.
---

# Organize

Read `../references/harness-folder-rules.md` first. Read `../references/helper-surface.md` when you need deterministic inspection, validation, apply, or backup behavior.

## Workflow

1. Parse the user's natural-language intent.
2. Inspect the relevant host files first, then inspect the current `.harness` snapshot for prior decisions and recorded evidence when it exists.
3. If `.harness` does not exist yet, treat that as normal. Use the live host files as the starting point and plan the snapshot files that should be created after the host changes are done.
4. Use deterministic helpers where they are stronger than ad hoc reasoning:
   - prompt section parsing and similarity
   - settings parsing and MCP inventories
   - malformed settings or parse-error detection
   - host profile paths and apply targets
   - local origin hints for skills, agents, and plugins
5. Ask follow-up questions only when the user intent is ambiguous or the merge/split decision has real semantic risk.
6. If not `--dry-run`, back up displaced host files first.
7. Update the real host files that the user actually uses.
8. Refresh or initialize `.harness` so it records the resulting snapshot, decisions, and origin notes.

## Settings And MCP Review

- Catch invalid or unsupported settings file formats when helpers can prove them.
- Flag malformed MCP definitions such as missing commands, unsupported shapes, parse errors, or host-only keys with no safe shared mapping.
- Propose optimizations when they are defensible:
  - deduplicate identical MCP servers across hosts
  - align truly shared MCP definitions across hosts
  - keep risky vendor-specific keys host-local
  - normalize env passthrough names instead of persisting secret values
  - prune stale copies or obsolete overrides

## Memory And Rules

- Route durable memory and prior decisions into `.harness/memory/`.
- Use `.harness/HARNESS.md` and `.harness/llm/*.md` as a record of analyzed or organized host guidance, not as authoritative truth.
- Direct host edits are allowed, but prefer `organize` when the user wants coordinated multi-host changes or durable decision tracking.

## Dry Run

- In `--dry-run`, do not write files.
- Show the relevant current state, the proposed host changes, the `.harness` snapshot updates that would follow, and any unresolved semantic questions.
- If `.harness` is absent, show which snapshot files would be created after the host changes instead of assuming snapshot files already exist.
