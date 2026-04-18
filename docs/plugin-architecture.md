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
- surface malformed MCP or settings definitions
- collect local origin hints
- refresh `.harness` as a snapshot when not in `--dry-run`
- never mutate host files

### `organize`

- accept natural-language maintenance requests
- inspect real host state first, then the current `.harness` snapshot
- update real host files
- catch settings and MCP errors
- propose or apply safe optimizations
- refresh `.harness` after applying changes

Both skills support `--dry-run`.

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
