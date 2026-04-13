# soft-harness

`soft-harness` keeps LLM project assets in one source of truth under `.harness/` and syncs host-native files back out with a single command.

It manages:

- instruction files such as `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`
- skills and agents under host-specific directories
- plugin install metadata in `.harness/plugins.yaml`
- backups and sync state for drift detection and revert

## Status

`v0.4.1` keeps the `.harness/` sync model and adds a read-only `analyze` command for comparing prompts, settings, skills, and agents across hosts. `analyze` now also lists every discovered prompt document and settings file before showing common/similar/conflict findings. The old registry schema, `harness/` tree, and legacy commands are gone. The active model is:

- `.harness/` is the source of truth
- `soft-harness sync` reconciles `.harness/` and the project
- `soft-harness revert` restores a backup snapshot

## Install

Requirements:

- Node.js 20+
- Git

```text
git clone https://github.com/softdaddy-o/soft-harness.git
cd soft-harness
npm install
node src/cli.js help
```

Optional global install:

```text
npm link
soft-harness help
```

## Commands

```text
soft-harness sync [--manual-review] [--dry-run] [--verbose] [--explain] [--yes] [--no-import] [--no-export] [--link-mode=copy|symlink|junction] [--force-export-untracked-hosts] [--no-run-installs] [--no-run-uninstalls]
soft-harness analyze [--category=all|prompts|settings|skills] [--llms=claude,codex,gemini] [--verbose] [--explain] [--json]
soft-harness revert --list
soft-harness revert <timestamp>
soft-harness help
```

## Quick Start

Run `sync` in a project that already has one or more host files such as `CLAUDE.md` or `AGENTS.md`:

```text
soft-harness sync --dry-run
soft-harness sync
```

On the first run, `soft-harness` imports discovered instruction files into `.harness/`, asks for review on adoption and common-section promotion, creates managed stubs at external locations, and writes sync state and backups.

Use `analyze` when you want a read-only comparison before deciding whether content should be merged or normalized:

```text
soft-harness analyze
soft-harness analyze --category=prompts --llms=claude,codex --explain
soft-harness analyze --json
```

The text report always lists discovered prompt documents and settings files first. `--explain` adds per-item details such as stub source files, discovered section headings, MCP server names, host-only keys, and parse errors.

## Layout

```text
.harness/
  HARNESS.md
  llm/
    claude.md
    codex.md
    gemini.md
  skills/
    common/
    claude/
    codex/
    gemini/
  agents/
    common/
    claude/
    codex/
    gemini/
  plugins.yaml
  .gitignore
  .sync-state.json
  backups/
```

External host files are regenerated from `.harness/`:

- Claude: `CLAUDE.md`, `.claude/CLAUDE.md`
- Codex: `AGENTS.md`
- Gemini: `GEMINI.md`

Skills and agents default to managed copy+marker exports for repo-internal host directories. Link exports are opt-in, and Windows junctions are treated as a compatibility mode instead of the default.

## Behavior

- Import: project edits and unmanaged files can be pulled into `.harness/`
- Export: missing or stale stubs, managed copies, and explicitly requested links are regenerated
- Summary: `sync` explains file moves, section routing, bucket assignment, and export targets; `--explain` adds downgrade and merge reasons
- Analyze: `analyze` is always read-only, lists discovered documents and settings, and then groups prompts, settings, and skills into `common`, `similar`, `conflicts`, `host_only`, and `unknown`
- Drift: managed targets are compared against regenerated expectations
- Conflict detection: if both `.harness/` and a project target changed since the last sync, `sync` reports a conflict instead of silently choosing one side
- Backup: non-dry-run syncs create a timestamped backup before writing
- Revert: restores a chosen backup snapshot without running plugin install or uninstall commands
- Git safety: repo-internal skill and agent exports stay Git-friendly by defaulting to managed copies instead of symlinks or junctions

## Trusted Publishing

`soft-harness` is configured for npm Trusted Publishing from GitHub Actions.

- Workflow: `.github/workflows/publish.yml`
- Package: `soft-harness`
- Owner: `softdaddy-o`
- Repository: `soft-harness`

The publish workflow runs `npm test` and publishes with provenance.

## License

MIT
