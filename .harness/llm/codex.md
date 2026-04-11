# AGENTS.md

Repository instructions for `soft-harness`.

## Purpose

This repository defines a single-truth harness for Claude and Codex environments.

The product scope is:

- discover current local setup
- normalize it into a shared registry
- generate host-native outputs
- detect drift and cleanup problems

It is not:

- an agent runtime
- an MCP server
- a plugin marketplace
- a secret manager

## Code Style

### JavaScript

- Use CommonJS unless a file already uses ESM.
- Use 4-space indentation.
- Use single quotes.
- Use semicolons.
- Keep functions small and explicit.

### YAML

- Prefer explicit keys over compact syntax.
- Keep schema examples realistic and minimal.

### Markdown

- Keep design docs concise and structured.
- Prefer concrete examples over abstract prose.

## Product Rules

- Registry is the source of truth.
- The `harness/` directory is the home for all user-managed Harness truth.
- Generated outputs must be clearly marked generated.
- Stable stubs may be hand-maintained, but must point to generated content.
- Vendor-native installers remain external to Harness.
- Secrets must never be committed.

## Initial Priorities

1. Registry schema
2. Guides model inside `harness/`
3. Discovery model
4. Doctor checks
5. Generate/apply model
6. Migration workflow
