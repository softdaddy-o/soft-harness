# Codex Agent TOML Design

## Goal

Fix Claude-to-Codex agent porting so `organize` produces real Codex agents in `.codex/agents/*.toml` and keeps `.harness` aligned with that host format.

## Problem

The current implementation treats Codex agents as YAML and stores them under `.harness/agents/codex/*.yaml`, then exports them to `.codex/agents/*.yaml`. That format is not recognized by Codex subagents. A newer but still incorrect direction also considered exporting Claude agents into `.codex/skills/<name>/SKILL.md` plus nested agent YAML. Issue `#10` makes the target format explicit: Codex agents are TOML files under `.codex/agents/`.

## Scope

- Convert Claude markdown agents into Codex TOML agents.
- Store Codex harness snapshots as TOML, not YAML.
- Export Codex agents only to `.codex/agents/*.toml`.
- Preserve the full Claude agent body as Codex `developer_instructions`.
- Support forward migration from legacy generated `.harness/agents/codex/*.yaml`.

Out of scope:

- changing Codex skill export behavior
- introducing new Codex agent optional fields beyond the mapped minimum
- supporting a long-lived dual YAML and TOML model

## Canonical Model

Codex agents are represented as:

- harness snapshot: `.harness/agents/codex/<name>.toml`
- host export: `.codex/agents/<name>.toml`

Claude source agents remain markdown:

- harness snapshot: `.harness/agents/claude/<name>.md`
- host source: `.claude/agents/<name>.md`

Generated Codex TOML is the only canonical Codex-agent representation after this change.

## Mapping

Claude markdown parsing:

- frontmatter `name` -> TOML `name`
- frontmatter `description` -> TOML `description`
- markdown body after frontmatter -> TOML `developer_instructions`

Fallback behavior:

- missing frontmatter `name`: use the slug titleized
- missing frontmatter `description`: derive a short description from the first meaningful paragraph
- malformed or missing frontmatter: treat the file as body-only markdown and still preserve the full body in `developer_instructions`

Losslessness rule:

- `developer_instructions` carries the complete Claude agent body text after frontmatter parsing
- no summarization, mission extraction, or prompt condensation

## Migration

Legacy generated files may exist at:

- `.harness/agents/codex/<name>.yaml`
- `.codex/agents/<name>.yaml`

Migration policy:

- `organize` prefers Claude markdown as the source of truth when present
- if a managed legacy Codex YAML snapshot exists, it is superseded by the new TOML snapshot on the next organize
- managed legacy `.codex/agents/*.yaml` exports are removed when replaced by TOML
- code may continue to read legacy YAML only long enough to avoid drift confusion during transition, but it should not write new YAML

## Origins and Drift

Asset origins stay in `.harness/asset-origins.yaml`.

Origin records for generated Codex agents continue to use:

- `kind: agent`
- `hosts: [codex]`

Notes should describe the new TOML conversion rather than a lossy YAML stub.

Drift and pullback should treat Codex TOML agents like any other file-based managed agent:

- compare file hash for copy-mode drift
- pull back `.codex/agents/<name>.toml` into `.harness/agents/codex/<name>.toml`

## Implementation Areas

### `src/skills.js`

- change supported Codex agent extensions from YAML to TOML
- replace YAML stub generation with TOML serialization
- preserve full markdown body in `developer_instructions`
- update import/export/discovery logic to target `.toml`
- handle legacy YAML migration and cleanup

### `src/profiles.js`

- keep Codex `agents_dir` as `.codex/agents`
- no Codex agent use of `.codex/skills` for this flow

### tests

Add or update tests for:

- markdown-to-TOML conversion
- plugin-provided Claude agent porting to TOML
- organize exporting `.codex/agents/*.toml`
- drift and pullback with Codex TOML agents
- legacy YAML replacement cleanup

## Risks

- existing tests and eval fixtures assume YAML and will fail until updated together
- legacy YAML cleanup must avoid deleting unrelated user files
- TOML multiline string formatting must remain stable enough for hash-based drift

## Recommended Execution

1. Add failing tests for TOML import/export and legacy YAML replacement.
2. Replace Codex YAML generation with TOML generation in `src/skills.js`.
3. Update supported Codex extensions and managed asset discovery.
4. Adjust eval fixtures and sync tests.
5. Run the full test suite.
