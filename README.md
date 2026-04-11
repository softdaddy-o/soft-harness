# soft-harness

`soft-harness` keeps LLM project assets in one source of truth under `.harness/` and syncs host-native files back out with a single command.

It manages:

- instruction files such as `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`
- skills and agents under host-specific directories
- plugin install metadata in `.harness/plugins.yaml`
- backups and sync state for drift detection and revert

## Status

`v0.3.0` is a clean break from the old registry-based prototype. The registry schema, `harness/` tree, and legacy commands are gone. The active model is:

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
soft-harness sync [--manual-review] [--dry-run] [--no-import] [--no-export] [--link-mode=copy|symlink|junction] [--force-export-untracked-hosts] [--no-run-installs] [--no-run-uninstalls]
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

On the first run, `soft-harness` imports discovered instruction files into `.harness/`, creates managed stubs at external locations, and writes sync state and backups.

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
