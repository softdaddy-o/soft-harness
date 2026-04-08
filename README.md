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

## Layout

```text
harness/
  registry.yaml
  registry.d/
  policies/
  templates/
  generated/
  state/
src/
```

## License

MIT
