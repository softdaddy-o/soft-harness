# Plugin Skill Structure and Export Safety Design

## Goal

Complete the remaining Codex migration/export work by:

- preserving original plugin skill directory structure when porting Claude plugin skills to Codex
- preventing invalid `SKILL.md` frontmatter caused by unquoted `description` values
- making generated Codex agent TOML safe for control characters and non-blank description requirements

This design covers issues `#7`, `#11`, `#12`, and `#13`.

## Problem Summary

Current `main` already fixed the older agent-destination and CRLF parsing issues, and the stale issues have been closed. The remaining real work clusters in three places:

1. Plugin skill migration is too shallow.
   The current port model is effectively centered on `SKILL.md`, but real plugin skills often depend on sibling files and shared `skills/` assets such as:
   - `visual-companion.md`
   - nested `scripts/`
   - nested `agents/`
   - shared `references/`

2. Generated or exported `SKILL.md` files can still be invalid for strict YAML frontmatter consumers when `description` contains `: ` as prose.

3. Generated Codex agent TOML can still fail when:
   - `developer_instructions` contains disallowed control characters
   - `description` ends up blank

## Scope

In scope:

- plugin-provided Claude skill migration to Codex
- preserving the original plugin `skills/` layout for migrated Codex skills
- `SKILL.md` frontmatter normalization for exported/generated skill files
- safer TOML serialization for generated Codex agents
- validation/tests for the above

Out of scope:

- changing the already-shipped Codex agent destination away from `.codex/agents/*.toml`
- reopening or re-implementing closed issues `#4` through `#10`
- redesigning the entire `.harness` asset model

## Core Design

### 1. Plugin skills preserve the original `skills/` structure

When a Claude plugin is assigned to `codex`, the migration unit is no longer "a single `SKILL.md` file." The migration unit becomes the plugin's original `skills/` subtree.

The migration should preserve the original relative layout from the plugin's `skills/` directory, including:

- each selected skill directory
- sibling shared directories such as `references/`
- nested `scripts/`
- nested `agents/`
- companion markdown files referenced from `SKILL.md`

This matches the user direction to "use the same structure with the original one."

### 2. Codex export keeps relative references working

The exported Codex skill tree should retain the original relative layout so references such as:

- `../references/helper-surface.md`
- `skills/brainstorming/visual-companion.md`
- nested `agents/openai.yaml`

continue to resolve using the same relative paths they used in the source plugin.

The design preference is structure preservation over self-contained rebundling. Duplicating or rebasing assets into per-skill bundles is explicitly avoided unless absolutely necessary.

### 3. `SKILL.md` frontmatter is normalized on write

When soft-harness writes or rewrites a `SKILL.md` as part of export or migration, it should normalize frontmatter instead of treating the file as an opaque byte copy.

Normalization rules:

- preserve existing frontmatter keys where possible
- ensure `description` exists and is non-blank
- emit `description` as a double-quoted YAML string
- escape embedded quotes and backslashes as needed for valid YAML

Fallback for missing description:

- first meaningful paragraph from body text
- otherwise heading or title-derived fallback

This addresses issue `#11` and the missing-description note inside it.

### 4. Codex agent TOML is made serialization-safe

Generated Codex TOML should:

- escape disallowed control characters in `developer_instructions`
- continue to preserve the full Claude body losslessly in semantic terms
- guarantee `description` is not blank

Description fallback order:

- frontmatter description when non-blank
- first meaningful paragraph
- title or name-derived fallback

Control characters in `developer_instructions` should be serialized as escaped unicode sequences so Codex's TOML parser accepts the file.

This addresses issue `#12`.

## Asset Model

### Harness snapshots

Harness should continue to own the canonical migrated copies under `.harness/`.

For plugin skills assigned to Codex:

- snapshot the preserved skill tree under `.harness/skills/codex/`
- include shared plugin `skills/` assets needed by the selected exported skills

The folder arrangement in `.harness/skills/codex/` should mirror the exported Codex layout closely enough that export remains a structure-preserving copy step.

### Origins

Continue using `.harness/asset-origins.yaml` for asset provenance instead of introducing a new provenance file.

Origins for migrated plugin skills should remain asset-level and record:

- plugin identity
- installed version
- source path within the plugin cache

## Validation

Migration and export should validate local file references after writing the Codex skill tree.

Minimum validation:

- parse each exported or generated `SKILL.md` frontmatter
- ensure `description` is present and valid
- inspect obvious local markdown references and confirm target files exist

At minimum, validation must catch the concrete broken examples from `#13`:

- `brainstorming` missing companion docs or scripts
- `analyze` and `organize` missing shared `references/`

## Implementation Areas

### `src/skills.js`

Primary implementation site.

Needed changes:

- add plugin skill discovery and import path, not just plugin agent discovery
- preserve plugin `skills/` subtree structure for selected Codex plugin skills
- normalize `SKILL.md` frontmatter on export or write
- harden Codex TOML serialization for control characters and blank descriptions
- add post-export validation hooks for migrated skill references

### tests

Add or update tests for:

- plugin skill migration preserving companion files and shared references
- `description` quoting in exported or generated `SKILL.md`
- fallback `description` generation when missing
- TOML control-character escaping
- TOML non-blank description fallback

## Recommended Execution Order

1. Add failing tests for `#11` and `#12` serializer behavior.
2. Add failing tests for `#7` and `#13` plugin-skill subtree preservation.
3. Implement TOML and `SKILL.md` normalization helpers.
4. Implement plugin skill subtree migration.
5. Add reference-validation coverage.
6. Run focused tests, then the full suite.

## Risks

- preserving the original plugin `skills/` structure may export shared assets that multiple skills depend on, so selection logic must avoid partial broken trees
- frontmatter rewriting must avoid destroying unrelated keys or formatting in managed files
- strict validation may surface pre-existing malformed source skills that were previously copied silently

## Acceptance Criteria

- plugin skill migration no longer produces `SKILL.md`-only broken Codex skill trees
- exported Codex skill trees preserve the source-relative layout needed by companion files and shared references
- generated or exported `SKILL.md` files use safe `description` quoting and do not omit description
- generated Codex TOML escapes invalid control characters and never writes a blank `description`
