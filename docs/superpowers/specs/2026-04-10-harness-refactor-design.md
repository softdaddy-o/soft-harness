# Harness Refactor Design (2026-04-10)

Status: proposed
Supersedes: schema v1 (`2026-04-09-schema-v1-design.md`)

## Mission

Consolidate the LLM harness surface of a project — instruction markdown, skills, agents, and installed plugins — into a single source of truth at `.harness/`, split into **common** and **per-LLM** buckets. At required external locations (root `CLAUDE.md`, `.claude/skills/...`, etc.), produce thin stubs, symlinks, or install metadata that point back to `.harness/`.

One command — `sync` — keeps `.harness/` and the project in agreement.

## Scope

Three asset types:

1. **Instructions** — root markdown files read by LLM hosts (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/CLAUDE.md`, etc.)
2. **Skills & Agents** — directories under `.claude/skills/`, `.claude/agents/`, `.codex/skills/`, etc.
3. **Plugins** — anything installed by a marketplace or package manager. Tracked as install metadata only; binary content is never copied into `.harness/`.

Out of scope: secrets, runtime state, vendor marketplaces themselves, agent runtimes, MCP servers as a product.

## Directory Structure

```
.harness/
  HARNESS.md                 # common instructions (main)
  llm/
    claude.md                # Claude-specific additions
    codex.md                 # Codex-specific additions
    gemini.md                # Gemini-specific additions
  skills/
    common/<name>/SKILL.md   # shared across LLMs
    claude/<name>/SKILL.md   # Claude-only
    codex/<name>/...
  agents/
    common/<name>.md
    claude/<name>.md
    codex/<name>.md
  plugins.yaml               # install metadata
  backups/<timestamp>/       # sync apply backups (gitignored)
  .sync-state.json           # last-sync snapshot (gitignored)
```

**Rules:**

- A given skill or agent belongs to **exactly one bucket**. No overlay / merge between `common/` and `claude/`. Variants across LLMs live in separate bucket copies.
- `HARNESS.md` holds content that is literally identical across all `llm/*.md` targets. Anything else lives in the per-LLM file.
- `plugins.yaml` is the only YAML in the system. Everything else is convention-based directories.

## What Appears at External Locations

| External target | Mechanism | Source |
|---|---|---|
| `CLAUDE.md` / `.claude/CLAUDE.md` | import-stub (if host supports imports) or concat-stub | `HARNESS.md` + `llm/claude.md` |
| `AGENTS.md` | import-stub or concat-stub | `HARNESS.md` + `llm/codex.md` |
| `GEMINI.md` | import-stub or concat-stub | `HARNESS.md` + `llm/gemini.md` |
| `.claude/skills/<name>/` | symlink (preferred) or copy+marker | `.harness/skills/common/<name>` or `.harness/skills/claude/<name>` |
| `.claude/agents/<name>` | symlink or copy+marker | `.harness/agents/common/<name>` or `.harness/agents/claude/<name>` |
| Installed plugins | **not written as files** | `plugins.yaml` `install` / `uninstall` commands |

## LLM Profiles (Built-in)

Each supported LLM has a profile baked into the tool. Profiles are upgraded with the tool, not configured by users.

```
claude:
  instruction_files: [CLAUDE.md, .claude/CLAUDE.md]
  supports_imports: true         # @path/to/file syntax
  skills_dir: .claude/skills
  agents_dir: .claude/agents
  plugins_manifest: .claude/settings.json

codex:
  instruction_files: [AGENTS.md]
  supports_imports: false        # verify per release
  skills_dir: .codex/skills
  agents_dir: .codex/agents
  plugins_manifest: .codex/config.toml

gemini:
  instruction_files: [GEMINI.md]
  supports_imports: false        # verify per release
  skills_dir: .gemini/skills
  agents_dir: .gemini/agents
```

**Profile verification**: exact spec details (supports_imports, manifest paths) must be confirmed against each LLM's current documentation at the time of implementation. Do not guess.

**Ambiguity handling**: when a file matches profiles for multiple LLMs (e.g., `AGENTS.md` historically claimed by multiple ecosystems), `sync` prompts the user to classify during the initial run and records the decision in `.sync-state.json`.

## The `sync` Command

`sync` is the single main command. It reconciles `.harness/` with the project in both directions, then (optionally) runs plugin install/uninstall commands.

### Flags

```
sync                        # bidirectional, auto-apply, install + uninstall (default)
sync --manual-review        # confirm each change interactively
sync --dry-run              # report planned changes, write nothing
sync --no-import            # skip project → .harness direction
sync --no-export            # skip .harness → project direction
sync --no-run-installs      # files only, skip plugin installs
sync --no-run-uninstalls    # files only, skip plugin uninstalls
```

**Default is auto-apply.** `--manual-review` walks through each proposed change and asks for confirmation. `--dry-run` writes nothing.

**Default is bidirectional.** Both `import` (project → `.harness/`) and `export` (`.harness/` → project) run. Opt out with `--no-import` / `--no-export`.

### Direction Semantics

- **Import (project → `.harness/`)**: files that exist in the project but not in `.harness/` get pulled in and classified. Files whose project-side copy is newer than the `.harness/` source get pulled back.
- **Export (`.harness/` → project)**: external targets are regenerated from `.harness/` sources. Outdated stubs, broken symlinks, and missing copies are fixed.
- **Direction resolution**: when both sides have content for the same asset, `mtime` determines which is newer.
- **Conflict detection**: if both sides have been modified since the last recorded sync (tracked via `.sync-state.json`), that's a conflict — sync surfaces a prompt regardless of mtime, because silently picking one side could discard real edits. In `--dry-run`, conflicts are listed as unresolved. In non-interactive mode (`--no-import` or `--no-export` excluding one side), the remaining direction wins without a prompt.

### Classification Prompts (Always Interactive)

Independent of `--manual-review`, `sync` will always prompt for questions that only a human can answer:

- "`AGENTS.md` matches profiles for both Codex and (some community convention). Which LLM owns it?"
- "Skill `foo` exists under `.claude/skills/` and `.codex/skills/` with different content. Treat as two separate bucket copies or merge into `common/`?"

Answers are cached in `.sync-state.json` so follow-up syncs don't re-ask.

### First Run vs Steady State

- **First run** (`.harness/` absent or nearly empty): discovers all matching assets, runs the common-content extraction heuristic (§ Common-Content Extraction), prompts for every ambiguous classification. Slow and interactive.
- **Steady state**: most syncs are near no-ops. Only newly added or edited files trigger work. Usually zero prompts.

## Common-Content Extraction

When instruction files are imported into `.harness/`, `sync` tries to split them into `HARNESS.md` (common) and `llm/<name>.md` (specific).

**Algorithm:**

1. Parse each instruction file into markdown sections by heading (`##`, `###`).
2. Normalize section bodies (trim, collapse whitespace) and hash.
3. Sections with **identical hashes** in 2+ files → `common` candidates. Default checked.
4. Sections appearing in exactly one file → LLM-specific. Default to that LLM's bucket.
5. Sections that are "near matches" (e.g., >80% textual overlap but not identical) → flagged as **maybe common**. Default **unchecked**. Require explicit user decision.
6. Write results: `common` → `HARNESS.md`, LLM-specific → `llm/<name>.md`, `maybe` → remain in the LLM-specific file unless user opted in.

**`--manual-review`** walks each `common` and `maybe` candidate and prompts explicitly. Without it, only exact matches auto-promote; `maybe` candidates stay put.

**Single-file case**: if only one instruction file is present (e.g., project has `CLAUDE.md` only), the "2+ matches" rule means nothing qualifies as common. All content goes to `llm/claude.md` and `HARNESS.md` is created empty (ready for user to move content into later). This is intentional — the tool should never guess that single-source content is "common".

**Not done by this algorithm:**

- Sub-section (sentence / paragraph) diffing — too error-prone
- Automatic fuzzy merge — results unpredictable
- Re-extraction on later syncs — first-run only; after that, the user edits `.harness/` directly

**Fallback when parse fails:** file with no headings is treated as a single block; `sync` moves the whole file to the LLM-specific bucket without extraction.

## Stub / Managed-Marker Formats

### Instructions — `supports_imports: true`

```markdown
<!-- Managed by soft-harness. Do not edit this file directly. -->
<!-- Source: .harness/HARNESS.md + .harness/llm/claude.md -->
<!-- Regenerate: soft-harness sync -->

@.harness/HARNESS.md
@.harness/llm/claude.md
```

**Drift rule**: entire file is managed. Any deviation is drift.
**Drift pull-back**: added content → `llm/claude.md` tail (default). `--manual-review` prompts: "HARNESS.md (common) or `llm/claude.md` (Claude-only)?"

### Instructions — `supports_imports: false`

```markdown
<!-- Managed by soft-harness. Do not edit this file directly. -->
<!-- Source: .harness/HARNESS.md + .harness/llm/codex.md -->
<!-- Regenerate: soft-harness sync -->
<!-- BEGIN HARNESS.md -->

[full HARNESS.md content]

<!-- END HARNESS.md -->
<!-- BEGIN llm/codex.md -->

[full llm/codex.md content]

<!-- END llm/codex.md -->
```

**Why BEGIN/END markers**: drift pull-back uses them to route edited blocks back to the right `.harness/` source file. LLMs treat them as inert comments.

**Drift rule**: byte-exact match required against the regenerated expected content.
**Drift pull-back**:
- Changes inside a `BEGIN X ... END X` block → routed to `.harness/` path `X`
- Content outside any block → default to `llm/<name>.md` tail
- `--manual-review` confirms each routing decision

### Skills / Agents — Symlink Mode (Preferred)

```
.claude/skills/my-skill/  →  .harness/skills/common/my-skill/   (symlink)
```

- POSIX: `symlink(2)`
- Windows: directory symlink via `mklink /D` or junction
- No additional marker — the symlink itself is the management signal

**Drift rule**: target is no longer a symlink, or points elsewhere → drift.
**Drift pull-back**: if the project-side replaced the symlink with real files, `sync` copies those files back into the `.harness/` source, then restores the symlink.

### Skills / Agents — Copy Mode (Fallback)

When symlink creation fails (Windows without developer mode, cross-filesystem restrictions, etc.), `sync` copies the directory and drops a hidden marker inside:

```
.claude/skills/my-skill/.harness-managed
```

Marker content:

```yaml
source: .harness/skills/common/my-skill
content_hash: sha256:abc123...
regenerate: soft-harness sync
```

**Drift rule**: recomputed content hash of `.claude/skills/my-skill/` (excluding the marker file) differs from `content_hash` in the marker.
**Drift pull-back**: diff the project-side copy against the `.harness/` source, propagate changes file-by-file back into `.harness/`, then update the marker's hash.

### Plugins — No File Stub

Plugins are not represented as files at external locations. Their state lives in:

- `.harness/plugins.yaml` — desired state (user-editable)
- `.harness/.sync-state.json` — last-reconciled state (gitignored)

`plugins.yaml` example:

```yaml
plugins:
  - name: superpowers
    llms: [claude]
    source:
      type: marketplace
      id: anthropic/superpowers
    version: 5.0.7
    install: claude plugin install superpowers
    uninstall: claude plugin uninstall superpowers
  - name: pencil-mcp
    llms: [claude, codex]
    source:
      type: github
      url: https://github.com/foo/pencil-mcp
    install: npm install -g pencil-mcp
    uninstall: npm uninstall -g pencil-mcp
```

**Sync behavior:**

- Compare `plugins.yaml` entries against `.sync-state.json` snapshot.
- New entry or version change → run `install` (unless `--no-run-installs`)
- Removed entry → run `uninstall` (unless `--no-run-uninstalls`)
- `llms:` field restricts which hosts' manifests are consulted during drift detection

**Drift detection (plugins)**: during import, `sync` reads each LLM's plugin manifest (e.g. `.claude/settings.json`) and compares installed plugins against `plugins.yaml`. Mismatches are reported. Manually installed plugins surface as "candidate for adoption" prompts in import.

## State Files

### `.harness/.gitignore`

On first sync, `sync` creates `.harness/.gitignore` with the standard set of ignore patterns:

```
.sync-state.json
backups/
```

This file is tracked in git (so new clones inherit the ignore rules). `sync` does not modify the project-root `.gitignore`.

### `.harness/.sync-state.json` (gitignored)

Snapshot of the last successful sync. Used for:

- Deletion detection (was-there-last-time, missing-now → propagate delete)
- Plugin install/uninstall decisions
- Cached classification answers (so ambiguous prompts don't re-ask)

Schema (illustrative):

```json
{
  "version": 1,
  "synced_at": "2026-04-10T14:23:00+09:00",
  "assets": {
    "instructions": [...],
    "skills": [...],
    "agents": [...]
  },
  "plugins": [
    {"name": "superpowers", "version": "5.0.7", "install_hash": "..."}
  ],
  "classifications": {
    "AGENTS.md": "codex"
  }
}
```

### `.harness/backups/<timestamp>/` (gitignored)

Every non-dry-run `sync` that performs destructive operations (file moves, deletions, overwrites) creates a timestamped backup before writing.

- Timestamp format: `YYYY-MM-DD-HHMMSS` (KST, per project convention)
- Contents: original file bytes for everything about to be modified or deleted
- Includes a `manifest.json` listing each backed-up path and its pre-sync state

## Revert

```
revert --list
revert <timestamp>
```

- `revert --list` shows available backup timestamps with brief summaries (file count, asset types touched).
- `revert <timestamp>` restores the selected backup: files are put back as they were before that sync.
- Revert itself creates a fresh backup first, so a revert can be reverted.
- Revert does **not** run plugin install/uninstall. Plugin state changes are reported but not reversed automatically (side-effectful, risky). User handles manually.

## Drift Summary Table

| Asset | Drift detected by | Pull-back behavior |
|---|---|---|
| Import-stub instruction | File != expected stub content | New content → `llm/<name>.md` tail; removed `@import` lines → warning only (or prompt in `--manual-review`) |
| Concat-stub instruction | Byte mismatch vs regenerated content | Route edits by BEGIN/END marker back to source path |
| Symlink skill/agent | Not a symlink, or wrong target | Copy back to `.harness/`, restore symlink |
| Copy skill/agent | Content hash mismatch | File-by-file diff propagated to `.harness/` source |
| Plugin | Installed set differs from `plugins.yaml` | Import prompts "adopt into plugins.yaml?" for unknowns; export runs install/uninstall |

## Explicitly Dropped (from Schema v1)

The following concepts from the current `registry.yaml` schema v1 are removed:

- `registry.yaml` central file
- `registry.d/` fragment imports
- `policies/` reusable policy packs
- `capabilities:` block
- `outputs:` block with `apply_path` / `apply_mode`
- `guides/` split (shared/claude/codex under registry control)
- Commands: `discover`, `migrate`, `generate`, `apply`, `approve`, `doctor`, `diff`, `preview`, `migrate-schema`, `init`, `account discover`, `restore` (functionality absorbed into `sync` + `revert`)
- `harness/generated/` intermediate stage
- Managed stub marker convention from v1 (replaced by the new formats above)
- Schema version field (directory convention doesn't need one; `plugins.yaml` may grow a `version:` key later if needed)

## Clean Break from v0.1.x

v0.2.0 is a functionally new tool that happens to share a name. It does not read legacy `registry.yaml`. Users of v0.1.x run `sync` in their project — discovery treats the legacy `harness/` directory as just another place where assets might live and proposes importing them into `.harness/`. No explicit migration path is shipped.

Rationale: v0.1.x is a recently published prototype with a tiny user base. The cost of maintaining a bridge is higher than the cost of one clean re-adoption.

## Bootstrapping Soft-Harness Itself

The soft-harness repository eats its own dogfood:

1. Existing `harness/` (registry.yaml etc.) and `AGENTS.md` become discoverable assets.
2. First sync imports them into `.harness/`, producing `HARNESS.md` (content that was in `AGENTS.md` common sections) and `llm/codex.md` (the Codex-specific parts).
3. The new `.harness/` directory becomes the repo's single source of truth.
4. Old `harness/` directory is removed after successful import.
5. Implementation source (`src/`) is rewritten around the new model in a subsequent phase.

## Open Questions (for implementation plan)

- Exact `supports_imports` capabilities for Codex and Gemini must be verified against their current documentation before implementing profiles.
- Plugin install/uninstall command execution: shell escaping, error handling, and partial-failure recovery semantics.
- Conflict resolution policy when both `.harness/` and project sides were edited since last sync (beyond simple mtime comparison).
- Windows symlink capability detection: how to decide symlink-vs-copy per asset without a failed attempt first.
- Whether LLM profiles should be overridable by a project-level `.harness/profiles.yaml` (current design: no, keep them tool-internal).

## Non-Goals

- A registry system with imports, policies, capabilities, outputs blocks
- Vendor plugin runtime or marketplace replication
- Secret management
- Agent runtime
- Any form of MCP server or proxy

---

**Decision log:**

- 2026-04-10: single `sync` command instead of separate `discover` / `migrate` / `generate` / `doctor`
- 2026-04-10: stub references (not symlinks) as default mechanism for instruction markdown; symlinks for skills/agents with copy fallback
- 2026-04-10: directory-based common/LLM split (not frontmatter-based)
- 2026-04-10: plugins tracked as install metadata, never as backed-up bytes; auto-install and auto-uninstall by default
- 2026-04-10: section-level exact-match heuristic for common-content extraction; fuzzy matches surfaced but not auto-applied
- 2026-04-10: clean break from schema v1 — no backward-compat bridge
