# Schema v0

This document is kept only as a historical note.

The old registry-based `harness/registry.yaml` model is no longer the active product design.

## Current Snapshot Model

Use `.harness/` as snapshot and decision memory, not as the source of truth:

- `.harness/HARNESS.md`
- `.harness/llm/`
- `.harness/settings/`
- `.harness/skills/`
- `.harness/agents/`
- `.harness/memory/`
- `.harness/plugins.yaml`
- `.harness/plugin-origins.yaml`
- `.harness/asset-origins.yaml`

## Current References

- active architecture: [plugin-architecture.md](./plugin-architecture.md)
- shared `.harness` rules: [../plugins/soft-harness/skills/references/harness-folder-rules.md](../plugins/soft-harness/skills/references/harness-folder-rules.md)

The real Claude Code and Codex files remain authoritative.

If you need the old registry-era thinking for archaeology or migration history, use the dated documents under `docs/superpowers/`.
