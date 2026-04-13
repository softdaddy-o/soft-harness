# Curate Workflow Design

## Goal

Define the next-step UX around harness organization without changing `sync` semantics.

The target workflow is:

```text
analyze -> curate -> sync
```

- `analyze` shows the current state
- `curate` edits `.harness` truth only
- `sync` remains bidirectional between `.harness` and host-native files

## Command Roles

### `analyze`

Read-only inventory and comparison.

It must answer:

- what exists
- where it exists
- whether it is shared, host-only, similar, conflicting, or unknown
- what stable id should be used for follow-up actions

### `curate`

Harness-internal organization.

It must:

- only edit `.harness`
- never write host outputs directly
- accept stable item ids from `analyze`
- support promote, demote, copy, and drop style operations

### `sync`

Bidirectional reconciliation and propagation.

It must:

- import unmanaged or drifted host-side changes back into `.harness`
- export curated `.harness` truth back to host files
- keep first-sync review and conflict handling semantics

## Stable Item Identity

`analyze --explain` should emit stable item metadata so `curate` can target the same entity later.

Current baseline metadata:

- `id`
- `present`
- `shared`

Examples:

```text
id: prompts.section:Git Conventions
present: claude, codex
shared: no
```

```text
id: settings.mcp.playwright
present: claude
shared: no
```

## Near-Term Implementation Order

1. Keep strengthening `analyze` inventory and stable ids
2. Add `curate` argument parsing and read-only preview mode
3. Add `.harness`-only mutations for a first small set of operations
4. Keep `sync` focused on reconciliation, not harness editing
