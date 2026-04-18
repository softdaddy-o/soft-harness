# Vision

## Problem

Claude Code and Codex setups drift across many local surfaces:

- host instruction files
- host settings and MCP definitions
- local skills and agents
- plugin metadata
- durable memory and rules

That drift makes it hard to explain the current state, safely reorganize it, or keep multiple hosts aligned.

## Goal

`soft-harness` should provide a plugin-first workflow where an LLM can inspect and organize real Claude Code and Codex state through shared skills while `.harness/` records the latest snapshot and user decisions.

The product model is:

- shared plugin content under `plugins/soft-harness/`
- host-specific wrappers for Claude Code and Codex
- `analyze` for current-state inspection and snapshot refresh
- `organize` for ongoing maintenance and repair of real host files
- thin deterministic helpers in `src/` for discovery, parsing, origin hints, apply steps, and backup

## Non-Goals

- building a generic multi-LLM runtime
- executing plugin install or uninstall commands
- acting as an MCP server
- storing secrets

## Current Direction

- host files remain authoritative
- `.harness/` stores prompts, settings, skills, agents, plugins, origins, and memory as the latest snapshot plus decision memory
- `analyze` and `organize` support dry-run workflows
- local analysis should help the LLM, not replace LLM judgment

## Success Criteria

- a user can inspect a messy Claude/Codex setup and capture its state into `.harness/`
- a user can ask for natural-language changes such as shared-vs-host-only splits
- malformed MCP/settings state is surfaced and explained
- host files can be updated safely while `.harness` stays in sync as remembered state
- a sanitized virtual-PC fixture can be used to test the workflow with an LLM
