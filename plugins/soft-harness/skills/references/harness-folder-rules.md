# `.harness` Folder Rules

Use this document as the structure reference for both `analyze` and `organize`.

## Core Rule

- `.harness/` is not the source of truth.
- The real Claude Code and Codex files remain authoritative.
- `.harness/` is a reusable snapshot plus decision memory captured from the last `analyze` or `organize` run.
- Use `.harness/` to remember prior decisions, evidence, and shared-vs-host-local reasoning so the same questions do not need to be asked twice.

## Snapshot Layout

```text
.harness/
  HARNESS.md
  llm/
    claude.md
    codex.md
    gemini.md
  settings/
    portable.yaml
    llm/
      claude.yaml
      codex.yaml
      gemini.yaml
  skills/
    common/<name>/SKILL.md
    claude/<name>/SKILL.md
    codex/<name>/SKILL.md
    gemini/<name>/SKILL.md
  agents/
    common/<name>.md
    claude/<name>.md
    codex/<name>.md
    gemini/<name>.md
  memory/
    shared.md
    llm/
      claude.md
      codex.md
      gemini.md
    INDEX.md          # optional: present only if per-topic reference files exist
    <topic>.md         # optional: user-authored per-topic reference files, listed in INDEX.md
  plugins.yaml
  plugin-origins.yaml
  asset-origins.yaml
  .sync-state.json
  backups/
```

## Meaning Of Each Area

- `HARNESS.md`: snapshot of rules or guidance that appear shared across hosts.
- `llm/*.md`: snapshot of host-specific prompt additions.
- `settings/portable.yaml`: snapshot of settings that appear safe to share across hosts. Full MCP definitions live under `mcp_servers`.
- `settings/llm/*.yaml`: snapshot of host-specific settings or overrides. Codex project-local MCP enable/disable policy can live under `mcp_server_overrides` so project files do not copy account-level commands, args, or secret-adjacent config.
- `skills/` and `agents/`: snapshot buckets recording whether an asset looks common or host-specific.
- `memory/`: durable user memory and prior decision notes. It may also hold an `INDEX.md` (one line per file: when to open it) plus additional topic-scoped reference files with arbitrary names — these are deliberate, user-authored reference content (e.g. operational pitfalls for a specific tool or workflow), not narrative decisions. Treat them as intentional: do not merge them into `shared.md`, do not fold them into `skills/`, and do not flag them as stale or duplicate just because they sit outside `shared.md`/`llm/*.md`.
- `plugins.yaml`: snapshot of plugin targeting and user decisions.
- `plugin-origins.yaml` and `asset-origins.yaml`: origin evidence collected from local hints plus later LLM research.
- `.sync-state.json` and `backups/`: implementation support files, not user-authored truth.

## Organizing Rules

- Treat host files as the live truth and `.harness` as the remembered state around that truth.
- Promote to shared only when the semantics are actually shared, not just similar.
- Keep risky or vendor-specific settings host-local.
- If a user says "remember this" or "add a rule", store it under `.harness/memory/` or the appropriate `.harness` prompt snapshot so the decision survives later runs.
- If a user asks to store standalone reference material for a specific topic (not a narrative decision), prefer a new `.harness/memory/<topic>.md` file plus a one-line entry in `.harness/memory/INDEX.md`, rather than appending it into `shared.md`. When `.harness/memory/INDEX.md` already exists, treat it and the files it lists as an established convention to preserve, not something to consolidate away.
- `analyze` may refresh `.harness` without mutating host files.
- `organize` should update host files first, then refresh `.harness` to match the new state.

## Direct Edit Policy

- Direct edits to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and host settings are allowed because those files are authoritative.
- Prefer `organize` when the user wants coordinated multi-host changes, decision tracking, malformed-settings review, or MCP optimization.
