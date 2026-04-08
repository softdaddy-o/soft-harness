# soft-harness

`soft-harness` is a governance-first harness for Claude and Codex environments.

It aims to provide a single source of truth for:

- instructions
- skills
- agents
- plugins
- MCP servers

Across two scopes:

- account-wide, per OS user
- project-wide

## Status

Working prototype.

The current goal is to support:

- discovery of current Claude and Codex state
- migration of unorganized local state into a structured registry
- generation of host-native outputs from a single registry
- drift detection and cleanup
- explicit output definitions for generated bundles and stable stubs
- reusable policy packs and example registries

## Principles

- Single truth is the Harness registry.
- Generated files are outputs, not hand-edited truth.
- Vendor-native installation flows stay vendor-native.
- Secrets stay local and out of tracked project config.
- Governance and cleanup come before automation.

## Planned Commands

```text
soft-harness discover
soft-harness doctor
soft-harness migrate
soft-harness generate
soft-harness diff
soft-harness apply
soft-harness approve [proposal-dir]
soft-harness restore [backup-id]
```

## Current MVP

- registry loading and validation
- `registry.d` fragment support
- guide buckets for shared, Claude-only, and Codex-only content
- discovery snapshots to `harness/state/discovered`
- doctor checks for registry issues, unmanaged assets, and possible plaintext secrets
- grouped migration proposal generation under `harness/registry.d/discovered/`
- migration backups under `harness/state/backups/`
- explicit output generation and apply flow
- account-wide and project-wide output presets
- generated MCP JSON outputs from registry-managed MCP capabilities
- approve command to promote grouped migration proposals into active `registry.d` files
- restore command for migration backups
- ignore rules for doctor and migrate noise reduction
- reusable policy packs under `harness/policies/`
- example registries under `examples/`

## Quick Start

Start from `harness/registry.yaml` and import reusable policy packs:

```yaml
version: 0

imports:
  - ./registry.d/*.yaml
  - ./policies/shared/governance-baseline.yaml
  - ./policies/shared/project-stubs.yaml
  - ./policies/shared/project-mcp.yaml

guides:
  shared:
    - path: common/project.md
      scope: project
  claude:
    - path: claude/review.md
      scope: project
  codex:
    - path: codex/build.md
      scope: project

capabilities: []
outputs: []
```

Then run:

```text
soft-harness generate
soft-harness apply
soft-harness doctor
```

## Layout

```text
harness/
  registry.yaml
  registry.d/
  guides/
    shared/
    claude/
    codex/
  policies/
  templates/
  generated/
  state/
src/
```

`harness/` is the home for user-managed truth.

That includes:

- registry files
- shared guides
- Claude-only guides
- Codex-only guides
- policy fragments
- generation templates
- reusable policy packs
- example registries and starter layouts

## License

MIT
