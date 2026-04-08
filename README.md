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

Early scaffold.

The initial goal is to support:

- discovery of current Claude and Codex state
- migration of unorganized local state into a structured registry
- generation of host-native outputs from a single registry
- drift detection and cleanup
- explicit output definitions for generated bundles and stable stubs

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
```

## Current MVP

- registry loading and validation
- `registry.d` fragment support
- guide buckets for shared, Claude-only, and Codex-only content
- discovery snapshots to `harness/state/discovered`
- doctor checks for registry issues, unmanaged assets, and possible plaintext secrets
- migration proposal generation to `harness/registry.d/discovered.generated.yaml`
- explicit output generation and apply flow

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

## License

MIT
