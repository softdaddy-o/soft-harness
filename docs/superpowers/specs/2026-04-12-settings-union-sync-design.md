# Settings Union Sync Design (2026-04-12)

Status: proposed
Depends on: `2026-04-10-harness-refactor-design.md`

## Mission

Add a settings-sync tool that discovers portable settings from each LLM host, normalizes them into a shared Harness model, computes the safe union, and writes that union back out to each host-native settings file.

The goal is not "make every config file identical". The goal is:

- union shared settings that have the same meaning across hosts
- keep host-only settings out of the shared model
- preserve unrelated host-native config
- make the first adoption review-driven

## Why This Is Separate From `sync`

The existing `sync` command manages source-of-truth content files:

- instructions
- skills
- agents
- plugins metadata

Host settings files are different:

- they contain both portable and host-only keys
- they are structured data, not generated stubs
- they must be merged surgically, not overwritten wholesale

Because of that, this feature should ship as a separate command:

```text
soft-harness sync-settings [options]
```

`sync` may call it later as an optional phase, but v1 should be a standalone command.

## Non-Goals

This tool does not try to unify:

- model names
- reasoning effort
- approval policy
- sandbox mode
- editor/UI preferences
- account/login state
- telemetry settings
- vendor plugin marketplace settings
- instruction file paths
- skills/agents directories
- secret values

If a setting does not have a clearly portable meaning, it stays host-local.

## v1 Scope

v1 should only sync **portable MCP/server-style settings** plus the non-secret metadata needed to reproduce them.

Included in v1:

- MCP server definitions
- transport type
- command
- args
- cwd
- env passthrough names
- enabled/disabled state when hosts support it

Explicitly excluded in v1:

- raw env var values
- approval policy
- tool permissions
- model defaults
- host UI settings
- marketplace/plugin settings

Rationale: MCP/server definitions are the highest-value shared config and the safest category to normalize first.

## Command Surface

```text
soft-harness sync-settings
soft-harness sync-settings --dry-run
soft-harness sync-settings --verbose
soft-harness sync-settings --explain
soft-harness sync-settings --manual-review
soft-harness sync-settings --yes
soft-harness sync-settings --llms=claude,codex,gemini
soft-harness sync-settings --category=mcp
```

### Flags

- `--dry-run`
  - compute and report changes, write nothing
- `--verbose`
  - show file-level routing and merge targets
- `--explain`
  - show why an entry was treated as portable, skipped, downgraded, or conflicting
- `--manual-review`
  - force review prompts even after first adoption
- `--yes`
  - auto-approve first-sync review prompts
- `--llms=...`
  - scope to a subset of supported hosts
- `--category=mcp`
  - v1 only supports `mcp`; the flag is future-proofing

## Harness Layout

Add a new tree under `.harness/`:

```text
.harness/
  settings/
    portable.yaml
    llm/
      claude.yaml
      codex.yaml
      gemini.yaml
```

### Meaning

- `portable.yaml`
  - the shared union set
- `llm/<name>.yaml`
  - portable-schema overrides or host-specific exceptions that are still meaningful in the shared schema
- host-native settings files remain external outputs, not source of truth

## Canonical Schema

v1 schema:

```yaml
version: 1
mcp_servers:
  playwright:
    transport: stdio
    command: npx
    args:
      - "@playwright/mcp@latest"
    cwd: .
    env_passthrough:
      - PLAYWRIGHT_BROWSERS_PATH
    enabled_for:
      - claude
      - codex
      - gemini
```

### Notes

- `env_passthrough` is a list of env var names only
- secret values are never stored
- `enabled_for` is explicit because not every portable entry must apply to every host

Per-LLM overrides use the same schema shape:

```yaml
version: 1
mcp_servers:
  local-only-helper:
    transport: stdio
    command: node
    args:
      - tools/helper.js
    enabled_for:
      - claude
```

## Host Adapters

Each profile gets an optional settings adapter:

```yaml
claude:
  settings_file: .claude/settings.json
  settings_adapter: claude-json

codex:
  settings_file: .codex/config.toml
  settings_adapter: codex-toml

gemini:
  settings_file: .gemini/settings.json
  settings_adapter: gemini-json
```

If an adapter is missing or not yet verified, that host is skipped with an explicit report entry.

## Portable vs Host-Only Classification

### Portable

A setting is portable only if all of these are true:

1. It can be expressed in the canonical schema.
2. It has the same operational meaning across hosts.
3. It does not require storing secrets.
4. Export can update only the managed subtree without clobbering unrelated settings.

### Host-Only

A setting is host-only if any of these are true:

- semantic meaning differs by host
- no canonical representation exists
- value is secret-bearing
- export would require overwriting a broad host config block

## Import Flow

### Discovery

For each selected LLM:

1. open the host settings file through its adapter
2. extract portable settings candidates
3. normalize them into canonical entries
4. record skipped host-only entries for reporting

### Union

Entries are grouped by canonical ID, for example MCP server name.

Cases:

- identical across 2+ hosts
  - goes to `.harness/settings/portable.yaml`
- present in only one host
  - default to `.harness/settings/llm/<host>.yaml`
- same ID but different normalized definitions
  - conflict, requires review

### Conflict Review

For conflicts, first sync should prompt:

1. choose one definition as canonical portable
2. keep separate host-local overrides
3. skip adoption for now

Example:

```text
Server "postgres" differs between Claude and Codex.
1. Use Claude version as portable
2. Use Codex version as portable
3. Keep separate per-LLM entries
4. Skip
```

## Export Flow

Export merges:

```text
portable.yaml + llm/<host>.yaml -> host settings adapter -> host-native file
```

Rules:

- only update managed portable subtrees such as `mcpServers` / `mcp_servers`
- preserve unrelated host-native keys byte-for-byte when possible
- remove previously managed portable entries that no longer exist in `.harness/settings/`
- do not remove unmanaged host-local keys

## Managed Boundaries

Unlike instruction stubs, settings files are not replaced wholesale.

The adapter owns only a well-defined subtree.

Examples:

- Claude JSON:
  - manage only `mcpServers`
- Codex TOML:
  - manage only `[mcp_servers]`
- Gemini JSON:
  - manage only the verified MCP subtree once the format is confirmed

Everything outside that subtree is preserved.

## First Sync Behavior

First `sync-settings` should be interactive by default in a TTY.

Review prompts:

- adopt this portable candidate?
- promote this entry to shared portable?
- keep this entry LLM-local?
- resolve this conflict?

`--yes` auto-approves safe defaults:

- identical multi-host entries -> portable
- single-host entries -> per-LLM file
- conflicts remain unresolved unless there is an explicit non-lossy fallback

## Reporting

`--dry-run --explain` should be the main UX.

Example output:

```text
dry-run: import=4 export=3 conflicts=1 skipped=6

imports:
  - .claude/settings.json:mcpServers.playwright -> .harness/settings/portable.yaml#mcp_servers.playwright
  - .codex/config.toml:mcp_servers.playwright -> .harness/settings/portable.yaml#mcp_servers.playwright
  - .claude/settings.json:mcpServers.desktop-commander -> .harness/settings/llm/claude.yaml#mcp_servers.desktop-commander

conflicts:
  - mcp server "postgres": claude vs codex args differ

skipped:
  - .claude/settings.json: model is host-only
  - .codex/config.toml: approval_policy is host-only

exports:
  - .harness/settings/portable.yaml + .harness/settings/llm/claude.yaml -> .claude/settings.json
  - .harness/settings/portable.yaml + .harness/settings/llm/codex.yaml -> .codex/config.toml
```

## State

Extend `.harness/.sync-state.json`:

```json
{
  "assets": {
    "settings": [
      {
        "llm": "claude",
        "target": ".claude/settings.json",
        "managed_subtree": "mcpServers",
        "hash": "..."
      }
    ]
  }
}
```

Use this for:

- drift detection
- deletion propagation of managed portable entries
- remembering prior conflict decisions

## Drift

Drift is only detected inside the managed subtree.

Cases:

- managed portable entry changed host-side
  - import candidate or conflict
- unmanaged host-local keys changed
  - ignored
- managed portable entry deleted host-side
  - drift

Pull-back behavior:

- if host-side change still normalizes cleanly, import it back into portable or per-LLM YAML
- if change conflicts with `.harness` state, prompt or report conflict

## Safety Rules

- secrets are never imported
- secret-looking env values are redacted and reported, not stored
- export never deletes unmanaged host-native keys
- first sync is review-driven
- unsupported adapters are skipped, not guessed

## Open Questions

- exact Gemini settings file format and MCP subtree path
- whether host adapters should preserve original formatting or rewrite canonical formatting
- whether per-LLM portable overrides belong in separate files or in a single `settings/llm.yaml`
- whether `sync` should later gain a `--with-settings` phase or keep this as a separate command permanently

## Initial Recommendation

Ship this in two steps:

1. v1: `sync-settings` for MCP/server definitions only
2. later: consider other portable categories only after explicit adapter mappings exist

That keeps the feature useful without pretending that all host settings are safely mergeable.
