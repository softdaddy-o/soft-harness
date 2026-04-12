# Settings Analyze Design (2026-04-13)

Status: proposed
Depends on: `2026-04-10-harness-refactor-design.md`
Related: `2026-04-12-settings-union-sync-design.md`

## Mission

Add a read-only command that inspects host settings across Claude, Codex, and Gemini, then summarizes:

- what is effectively common
- what is similar but not safely common
- what is host-only
- what is in conflict
- what is unknown or not yet classified

This command does not change files. Its job is to make later consolidation decisions easier.

## Why `analyze` Comes Before `sync`

The real user need is:

- "My Claude and Codex settings feel mostly duplicated."
- "Before trying to merge them, show me what actually overlaps."

That means the first useful feature is analysis, not synchronization.

If we jump directly to a union-sync command:

- we risk merging settings that only look similar
- we hide host-specific semantics too early
- we make bad source-of-truth decisions without enough visibility

So the correct order is:

1. `analyze`
2. refine classification rules from real-world output
3. only then consider `sync-settings`

## Command Surface

```text
soft-harness analyze
soft-harness analyze --verbose
soft-harness analyze --explain
soft-harness analyze --json
soft-harness analyze --llms=claude,codex
soft-harness analyze --category=all
soft-harness analyze --category=mcp
```

## Consistency With Existing Commands

This command must stay clearly separate from `sync`.

### `sync --dry-run`

`sync --dry-run` answers:

- "Given the current `.harness` source of truth, what would be imported, exported, or flagged as drift?"

It is:

- action-oriented
- source-of-truth aware
- write-capable in normal mode
- about planned reconciliation

### `analyze`

`analyze` answers:

- "Looking only at the host settings as they exist now, what is common, similar, host-only, conflicting, or unknown?"

It is:

- comparison-oriented
- read-only
- not source-of-truth driven
- about understanding overlap before any merge or sync model exists

### Design Rule

- `sync --dry-run` shows planned actions
- `analyze` shows observed structure
- `analyze` never reports import/export/drift/conflict counts
- `sync` never uses `common/similar/host-only/unknown` as its primary vocabulary

That keeps the two commands complementary instead of overlapping.

### Flags

- `--verbose`
  - show file-level and key-level entries instead of only high-level counts
- `--explain`
  - explain why an entry was classified as common, similar, host-only, conflict, or unknown
- `--json`
  - emit structured machine-readable output instead of text summary
- `--llms=...`
  - analyze a subset of supported hosts
- `--category=...`
  - analyze only a selected settings category

## No `--dry-run`

`analyze` is read-only by definition. It never writes files, updates state, creates backups, or changes host settings.

Because of that, `--dry-run` would be redundant and should not exist.

This is an intentional difference from `sync`.

## Initial Recommendation

v1 should support:

- `--category=all`
- `--category=mcp`

But classification quality should be strongest for `mcp`.

## What Counts As a "Setting"

For analysis, a setting is a normalized entry with:

- source host
- source file
- path inside that file
- category
- canonical key
- normalized value
- raw value

Example:

```json
{
  "llm": "claude",
  "source_file": ".claude/settings.json",
  "path": "mcpServers.playwright",
  "category": "mcp",
  "key": "playwright",
  "normalized": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  },
  "raw": {
    "transport": "stdio",
    "command": "npx",
    "args": ["@playwright/mcp@latest"]
  }
}
```

## Output Buckets

The command groups analyzed settings into five buckets.

### 1. Common

Use `common` when:

- two or more hosts contain entries that normalize to the same canonical meaning

This means "safe candidate for future merging", not "already merged".

Example:

```text
common:
  - mcp.playwright
  - mcp.context7
```

### 2. Similar

Use `similar` when:

- entries appear to represent the same conceptual setting
- but their normalized values differ enough that auto-merging would be risky

Examples:

- same MCP server name, different args
- same approval concept, different host semantics
- same sandbox concept, different value vocabularies

Example output:

```text
similar:
  - sandbox: claude=workspace-write, codex=danger-full-access
  - mcp.postgres: same server name, different args
```

### 3. Host-Only

Use `host-only` when:

- a setting is clearly meaningful only to one host
- or no cross-host mapping exists

Examples:

- Claude marketplace settings
- Codex reasoning effort defaults
- Gemini-specific editor or account settings

### 4. Conflict

Use `conflict` when:

- entries share the same canonical identity
- but the actual values are materially incompatible
- and they cannot even be downgraded to merely "similar"

This is stronger than `similar`. It means:

- same thing
- mutually incompatible definitions

Example:

```text
conflicts:
  - mcp.playwright.command
  - mcp.postgres.args
```

### 5. Unknown

Use `unknown` when:

- the parser can read the entry
- but no classification rule exists yet

This bucket is critical. It shows where the adapter coverage is incomplete.

## Categories

v1 categories:

- `mcp`
- `approval`
- `sandbox`
- `model`
- `ui`
- `plugins`
- `other`

### v1 Support Level

- `mcp`
  - first-class normalized analysis
- `approval`, `sandbox`, `model`
  - best-effort analysis only
- `ui`, `plugins`, `other`
  - primarily host-only or unknown in v1

## Host Adapters

Each LLM profile can define a settings adapter:

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

The adapter must:

1. read the host file format
2. extract settings entries
3. normalize known portable-ish categories
4. mark unsupported entries as host-only or unknown

## Normalization Rules

### MCP

Canonical key:

```text
mcp.<server-name>
```

Normalized shape:

```json
{
  "transport": "stdio",
  "command": "npx",
  "args": ["@playwright/mcp@latest"],
  "cwd": ".",
  "env_names": ["PLAYWRIGHT_BROWSERS_PATH"],
  "enabled": true
}
```

Normalization rules:

- ignore JSON/TOML/YAML syntax differences
- compare env var names, not raw values
- compare args structurally, not as joined strings
- normalize path separators where safe

### Approval / Sandbox / Model

These should be analyzed conservatively.

They may be reported as:

- `similar`
- `host-only`
- `unknown`

They should not be promoted to `common` unless meaning is verified.

## Text Output

Default output should be short and useful:

```text
analyze: common=2 similar=3 conflicts=1 host_only=12 unknown=6

common:
  - mcp.playwright
  - mcp.context7

similar:
  - sandbox
  - mcp.postgres

conflicts:
  - mcp.playwright.command
```

### `--verbose`

Add source locations:

```text
common:
  - mcp.playwright
    claude: .claude/settings.json#mcpServers.playwright
    codex: .codex/config.toml#mcp_servers.playwright
```

### `--explain`

Add reasons:

```text
common:
  - mcp.playwright
    reason: normalized command, args, transport, and env_names are identical

similar:
  - sandbox
    reason: both express workspace/tool restrictions, but host value vocabularies differ

host-only:
  - claude.plugins.marketplace
    reason: no codex/gemini equivalent mapping exists
```

## JSON Output

`--json` should emit:

```json
{
  "summary": {
    "common": 2,
    "similar": 3,
    "conflicts": 1,
    "host_only": 12,
    "unknown": 6
  },
  "common": [...],
  "similar": [...],
  "conflicts": [...],
  "host_only": [...],
  "unknown": [...]
}
```

This should be stable enough for future tooling.

## First Implementation Scope

v1 should answer these questions well:

1. Which MCP servers are identical across Claude and Codex?
2. Which MCP servers share a name but differ?
3. Which settings are clearly host-only?
4. Which settings categories are still unknown?

If it does that reliably, it is already useful.

## Success Criteria

This feature is successful if a user can run:

```text
soft-harness analyze --explain
```

and immediately understand:

- what can probably be unified later
- what should stay separate
- what needs manual judgment

without touching any files.

## Relationship To Future `sync-settings`

This command should produce the evidence needed to design `sync-settings`.

Future rule:

- nothing becomes auto-synced unless `analyze` can already classify it cleanly

That keeps the later sync feature grounded in real observed data instead of assumptions.
