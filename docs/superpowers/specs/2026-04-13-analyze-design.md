# Analyze Design (2026-04-13)

Status: proposed
Depends on: `2026-04-10-harness-refactor-design.md`
Supersedes in scope: `2026-04-13-settings-analyze-design.md`

## Mission

Add a read-only command that inspects the LLM-facing project surface and explains:

- what is common across hosts
- what is similar but not safely common
- what is host-specific
- what conflicts
- what is still unknown

This analysis must cover not only settings, but also prompts such as:

- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `AGENTS.md`
- `GEMINI.md`

Those prompt files are first-class input to the analysis, not a side topic.

## Command

```text
soft-harness analyze
soft-harness analyze --verbose
soft-harness analyze --explain
soft-harness analyze --json
soft-harness analyze --llms=claude,codex
soft-harness analyze --category=all
soft-harness analyze --category=prompts
soft-harness analyze --category=settings
soft-harness analyze --category=skills
```

## No `--dry-run`

`analyze` is read-only by definition.

It:

- does not import
- does not export
- does not write `.harness`
- does not create backups
- does not update sync state

So `--dry-run` would be redundant and should not exist.

## Difference From `sync --dry-run`

`sync --dry-run` answers:

- "Given the current `.harness` source of truth, what actions would run?"

`analyze` answers:

- "Looking at the current host-facing files, what is shared, what differs, and what could later be consolidated?"

So:

- `sync --dry-run` is action-oriented
- `analyze` is comparison-oriented

They should not share the same vocabulary.

`sync --dry-run` should talk in terms of:

- import
- export
- drift
- conflict

`analyze` should talk in terms of:

- common
- similar
- host-only
- conflict
- unknown

## Categories

v1 categories:

- `prompts`
- `settings`
- `skills`

`all` means all implemented categories.

### Initial Priority

Priority order for v1 quality:

1. `prompts`
2. `settings`
3. `skills`

Reason:

- prompts are central to actual LLM behavior
- settings matter, but prompt duplication is often the first pain point users feel
- skills analysis is useful, but can come after prompt/settings comparison is solid

## Prompt Analysis

### Goal

Show how instruction/prompt files overlap across hosts and where they diverge.

This includes:

- identical sections
- near-match sections
- host-only sections
- structural mismatches

### Input Files

Prompt analysis reads discovered instruction files such as:

- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `AGENTS.md`
- `GEMINI.md`

### Unit of Comparison

Prompt files should be analyzed by markdown section first, using the same parsing model already used for extraction:

- heading
- normalized body
- section hash

This keeps `analyze` aligned with the existing instruction import logic.

### Prompt Output Buckets

#### Common

Sections that are byte-equivalent or normalization-equivalent across 2+ hosts.

Example:

```text
common:
  - prompts.section: "Code Style"
  - prompts.section: "Testing"
```

#### Similar

Sections with the same heading or obvious conceptual match, but different body content.

Example:

```text
similar:
  - prompts.section: "Environment"
    claude: "Use MCP servers from .mcp.json"
    codex: "Use the shared local tools when available"
```

#### Host-Only

Sections that exist only for one host.

Example:

```text
host-only:
  - prompts.section: "Codex-specific"
```

#### Conflict

Sections that claim the same role but prescribe materially incompatible behavior.

Example:

```text
conflicts:
  - prompts.section: "Code Style"
    claude: "4-space indentation"
    codex: "2-space indentation"
```

#### Unknown

Prompt content that cannot be sectioned or mapped cleanly.

Examples:

- headingless blobs
- non-markdown structured prompt fragments
- generated content with no stable section boundaries

## Settings Analysis

Settings stay important, but they are one category among several.

### v1 Focus

v1 settings analysis should still be strongest for MCP/server definitions, but the command must be framed as a general analyzer, not an MCP-only tool.

### Settings Output Buckets

Use the same top-level buckets:

- common
- similar
- host-only
- conflict
- unknown

Examples:

```text
common:
  - settings.mcp.playwright

similar:
  - settings.sandbox

host-only:
  - settings.claude.plugins.marketplace
```

## Skills Analysis

Skills should be compared by:

- skill name
- presence across hosts
- directory hash
- `SKILL.md` content similarity

v1 does not need deep semantic skill analysis, but should at least answer:

- which skills are identical
- which exist only in one host
- which share a name but differ

## Shared Output Shape

Default text output:

```text
analyze: common=4 similar=6 conflicts=2 host_only=9 unknown=3

common:
  - prompts.section: "Code Style"
  - settings.mcp.playwright

similar:
  - prompts.section: "Environment"
  - settings.sandbox

conflicts:
  - prompts.section: "Approval Policy"
```

### `--verbose`

Adds file-level source locations.

Example:

```text
common:
  - prompts.section: "Code Style"
    claude: CLAUDE.md
    codex: AGENTS.md
```

### `--explain`

Adds reasons for classification.

Example:

```text
common:
  - prompts.section: "Code Style"
    reason: normalized section bodies are identical

similar:
  - settings.sandbox
    reason: both describe execution restrictions, but host value vocabularies differ
```

### `--json`

Stable structure:

```json
{
  "summary": {
    "common": 4,
    "similar": 6,
    "conflicts": 2,
    "host_only": 9,
    "unknown": 3
  },
  "common": [],
  "similar": [],
  "conflicts": [],
  "host_only": [],
  "unknown": []
}
```

Every item should include:

- `category`
- `kind`
- `key`
- `sources`
- optional `reason`

## Internal Design

The command should use per-category analyzers under a shared framework:

```text
src/
  analyze.js
  analyze/
    prompts.js
    settings.js
    skills.js
    format.js
```

### Analyzer Contract

Each analyzer returns normalized findings using the same shape:

```js
{
  common: [],
  similar: [],
  conflicts: [],
  hostOnly: [],
  unknown: []
}
```

This keeps CLI output and JSON formatting consistent.

## Relationship To Existing Logic

Prompt analysis should reuse the same section parser and normalization logic already used for instruction extraction where possible.

That avoids two different notions of "same prompt section".

Settings analysis should reuse host adapters once they exist.

Skills analysis should reuse existing discovery and hashing logic where possible.

## Success Criteria

This feature succeeds if a user can run:

```text
soft-harness analyze --explain
```

and immediately answer:

- which prompt sections can probably move into shared `.harness/HARNESS.md`
- which settings are effectively duplicated
- which skills are portable vs host-specific
- what should remain separate

before attempting any consolidation.

## Recommendation

Implement `prompts` first.

That gives the fastest value and directly addresses the current user need. After that:

1. `settings`
2. `skills`

Then revisit whether a future `sync-settings` still needs to exist, or whether prompt/setting consolidation should stay manual and analysis-led.
