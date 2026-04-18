# Roadmap

## Current State

The active product direction is plugin-first and `.harness`-centric.

Implemented or in progress:

- shared plugin core under `plugins/soft-harness/`
- dual wrappers for Claude Code and Codex
- `analyze` and `organize` skills
- `.harness` snapshot, decision-memory, and settings layout
- thin helper support for apply, backup, settings inspection, and origin hints
- sanitized virtual-PC fixture generation for LLM-driven testing

## Near-Term Work

1. Keep shrinking the legacy CLI surface into debug-only helpers.
2. Align helper code with host-authoritative state instead of `.harness`-authoritative export flows.
3. Improve `organize` support for MCP/settings validation and optimization guidance.
4. Expand fixture-based end-to-end testing around real-world adoption scenarios.

## Not On The Roadmap

- restoring the old registry-first product model
- reintroducing plugin install/uninstall execution
- treating `.harness` as more authoritative than the real host files
