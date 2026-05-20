# Plugin-First Architecture

This repository is moving from a CLI-first tool to a plugin-first workflow built around a shared core plus host-specific wrappers.

## User-Facing Product

- primary UX: the shared plugin core in [`../plugins/soft-harness`](../plugins/soft-harness)
- primary entrypoints: the `analyze` and `organize` skills
- authoritative state: the real Claude Code and Codex files
- `.harness/`: a reusable snapshot plus decision-memory layer

## Wrapper Model

The plugin content is shared. Distribution wrappers are host-specific.

### Claude Code Wrapper

- marketplace: [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json)
- plugin manifest: [`../plugins/soft-harness/.claude-plugin/plugin.json`](../plugins/soft-harness/.claude-plugin/plugin.json)
- shared content root: [`../plugins/soft-harness`](../plugins/soft-harness)

### Codex Wrapper

- marketplace: [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json)
- plugin manifest: [`../plugins/soft-harness/.codex-plugin/plugin.json`](../plugins/soft-harness/.codex-plugin/plugin.json)
- shared content root: [`../plugins/soft-harness`](../plugins/soft-harness)

## Skill Responsibilities

### `analyze`

- inspect the current host prompts, settings, skills, agents, plugins, and memory candidates
- compare shared-vs-host-local opportunities
- flag Claude and Codex memory entries that look cross-host, project-state, stale, or host-only
- surface malformed MCP or settings definitions
- collect local origin hints
- refresh `.harness` as a snapshot when not in `--dry-run`
- never mutate host files

### `organize`

- accept natural-language maintenance requests
- inspect real host state first, then the current `.harness` snapshot
- update real host files
- catch settings and MCP errors
- partition Claude/Codex memory into shared `.harness/memory/`, project docs, host-local memory, or removal when requested
- mark imported memory with source-host provenance and `do not reverse-merge` instructions, then track it in `.harness/memory/partition-state.json`
- propose or apply safe optimizations
- refresh `.harness` after applying changes

Both skills support `--dry-run`.

## Hook Integration

Soft Harness does not install host hooks automatically. The supported hook command is `soft-harness organize --partition-memory --dry-run`, which can be attached to host lifecycle or file-change hooks to report drift after:

- Claude project memory changes
- Codex memory file changes
- `.harness/`, `AGENTS.md`, `CLAUDE.md`, skill, agent, or plugin changes

Hooks should stay non-destructive by default. Use the non-dry-run partition command only from a deliberately trusted managed hook or from an explicit user action.

## `.harness` Model

`.harness/` is no longer the source of truth.

It stores:

- the latest analyzed or organized snapshot
- user decisions about shared vs host-specific placement
- remembered rules and durable notes
- plugin and asset origin evidence
- support state such as backups or sync metadata

The host files remain authoritative.

## Shared Plugin Core

The shared plugin directory contains:

- `skills/analyze`
- `skills/organize`
- `skills/references`

The wrappers should stay thin and should not duplicate skill content.

## Thin Deterministic Helper Surface

Keep code only where exact parsing, validation, local evidence extraction, apply steps, or backup behavior matter.

### Retain

- `src/profiles.js`
- `src/discover.js`
- `src/md-parse.js`
- `src/section-match.js`
- `src/analyze/settings.js`
- `src/settings.js`
- `src/plugins.js`
- `src/skills.js`
- `src/memory-partition.js`
- `src/export.js`
- `src/backup.js`
- `src/revert.js`
- `src/state.js`
- `src/origins.js`
- `src/asset-origins.js`
- `src/plugin-origins.js`
- `src/fs-util.js`
- `src/fs-backend.js`
- `src/hash.js`
- `src/virtual-pc.js`

### Demote To Internal Or Debug

- `src/cli.js`
- the current `sync`, `prompt`, `remember`, and import commands as end-user product surface
- deterministic flows that still assume `.harness` is authoritative

## Explicitly Out Of Scope

- plugin install or uninstall execution
- treating `.harness` as the canonical truth over host files
- replacing semantic user judgment with deterministic merge rules
