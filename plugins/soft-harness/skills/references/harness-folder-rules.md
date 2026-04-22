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
  hooks/
    <hook-name>
  plugins.yaml
  plugin-origins.yaml
  asset-origins.yaml
  .sync-state.json
  backups/
```

## Meaning Of Each Area

- `HARNESS.md`: snapshot of rules or guidance that appear shared across hosts.
- `llm/*.md`: snapshot of host-specific prompt additions.
- `settings/portable.yaml`: snapshot of settings that appear safe to share across hosts.
- `settings/llm/*.yaml`: snapshot of host-specific settings or overrides.
- `skills/` and `agents/`: snapshot buckets recording whether an asset looks common or host-specific.
- `memory/`: durable user memory and prior decision notes.
- `hooks/`: tracked hook scripts that the user may choose to install manually into `.git/hooks/`.
- `plugins.yaml`: snapshot of plugin targeting and user decisions.
- `plugin-origins.yaml` and `asset-origins.yaml`: origin evidence collected from local hints plus later LLM research.
- `.sync-state.json` and `backups/`: implementation support files, not user-authored truth.

## Organizing Rules

- Treat host files as the live truth and `.harness` as the remembered state around that truth.
- Promote to shared only when the semantics are actually shared, not just similar.
- Keep risky or vendor-specific settings host-local.
- If a user says "remember this" or "add a rule", store it under `.harness/memory/` or the appropriate `.harness` prompt snapshot so the decision survives later runs.
- `analyze` may refresh `.harness` without mutating host files.
- `organize` should update host files first, then refresh `.harness` to match the new state.

## Direct Edit Policy

- Direct edits to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and host settings are allowed because those files are authoritative.
- Prefer `organize` when the user wants coordinated multi-host changes, decision tracking, malformed-settings review, or MCP optimization.
