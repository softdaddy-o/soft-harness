Repository instructions shared across hosts for `soft-harness`.

## Purpose

This repository defines a plugin-first workflow for analyzing and organizing real Claude Code and Codex state while keeping `.harness` as a reusable snapshot and decision-memory layer.

The product scope is:

- keep shared plugin content under `plugins/soft-harness/`
- provide `analyze` and `organize` skills through Claude and Codex wrappers
- keep `.harness/` as the latest analyzed or organized snapshot of prompts, settings, skills, agents, plugins, and memory
- use thin deterministic helpers in `src/` only for parsing, apply, backup, and local evidence collection

It is not:

- an agent runtime
- an MCP server
- a plugin installer
- a plugin marketplace
- a secret manager

## Product Rules

- Real host files are the source of truth.
- `.harness/` stores snapshot state, prior decisions, and memory so later runs do not need to rediscover everything.
- `analyze` may refresh `.harness` without mutating host files.
- `organize` should update host files first and then refresh `.harness`.
- Memory should live under `.harness/memory/`.
- Shared settings should live under `.harness/settings/portable.yaml`.
- Host-specific settings should live under `.harness/settings/llm/<host>.yaml`.
- Plugin install and uninstall execution are out of scope.
- Secrets must never be committed.

## Code Style

### JavaScript

- Use CommonJS unless a file already uses ESM.
- Use 4-space indentation.
- Use single quotes.
- Use semicolons.
- Keep functions small and explicit.

### YAML

- Prefer explicit keys over compact syntax.
- Keep examples realistic and minimal.

### Markdown

- Keep design docs concise and structured.
- Prefer concrete examples over abstract prose.
