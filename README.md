# soft-harness

`soft-harness` keeps LLM project assets in one source of truth under `.harness/` and syncs host-native files back out with a single command.

It manages:

- instruction files such as `CLAUDE.md`, `AGENTS.md`, and `GEMINI.md`
- skills and agents under host-specific directories
- plugin install metadata in `.harness/plugins.yaml`
- backups and sync state for drift detection and revert

## Status

`v0.4.15` keeps the `.harness/` sync model, adds an in-memory filesystem test backend for broader unit coverage, keeps symlink and junction checks in focused real-filesystem tests, starts the `analyze -> curate -> sync` workflow with stable analyze item metadata, lets `sync`, `analyze`, and `curate` target either an explicit `--root` or the current account home with `--account`, extends `analyze` with document-first inventory for prompts, settings, skills, and plugins, narrows plugin manifest parsing to real plugin fields so Claude permission rules, status line commands, Gemini footer items, and MCP args are not misclassified as plugins, and replaces built-in GitHub repository guessing with an LLM-assisted plugin research flow that stores curated origin and latest-version metadata in `.harness/plugin-origins.yaml`. The old registry schema, `harness/` tree, and legacy commands are gone. The active model is:

- `.harness/` is the source of truth
- the intended workflow is `analyze -> curate -> sync`
- `soft-harness sync` reconciles `.harness/` and the project
- `soft-harness remember` records memory into harness truth and regenerates outputs
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
soft-harness sync [--root=<path>|--account] [--manual-review] [--dry-run] [--verbose] [--explain] [--yes] [--no-import] [--no-export] [--link-mode=copy|symlink|junction] [--force-export-untracked-hosts] [--no-run-installs] [--no-run-uninstalls] [--heading-threshold=<0..1>] [--body-threshold=<0..1>]
soft-harness analyze [--root=<path>|--account] [--category=all|prompts|settings|skills|plugins] [--llms=claude,codex,gemini] [--heading-threshold=<0..1>] [--body-threshold=<0..1>] [--verbose] [--explain] [--json]
soft-harness curate plugins [--root=<path>|--account] --input=<path>
soft-harness remember [--scope=project|account] [--llm=shared|claude|codex|gemini] [--section=<name>] --title=<name> --content=<text> [--no-export]
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
soft-harness analyze --category=plugins --account
soft-harness analyze --json
soft-harness curate plugins --input=plugin-research.json
```

The text report is document-first. It lists discovered prompt documents, settings files, skills, and plugins before any similarity buckets. `--explain` adds inline English annotations such as whether a matching section also exists on another host, whether it was kept separate because similarity stayed below the configured threshold, the backing source for managed stubs, discovered section headings, MCP server names, host-only keys, parse errors, and plugin provenance details such as curated origin, repository, installed version, latest version, and update availability. JSON analysis also emits a plugin research packet that can be handed to an external LLM. The intended loop is: `soft-harness analyze --category=plugins --json` -> let an LLM infer repository origin and latest version -> save that result to JSON or YAML -> `soft-harness curate plugins --input=<path>` -> rerun `soft-harness analyze --category=plugins --explain`.

Use `remember` when a user asks you to record guidance or memory into the harness source of truth instead of editing generated host files directly:

```text
soft-harness remember --title="Timezone" --content="Always use KST"
soft-harness remember --scope=account --llm=claude --section="Working Agreements" --title="Code Review" --content="Lead with findings."
```

`--scope=project` writes to the current project's `.harness/`. `--scope=account` writes to the user's home `.harness/` and regenerates the home-level host files from there.

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
  plugin-origins.yaml
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
- Remember: writes a titled memory entry into `.harness/HARNESS.md` or `.harness/llm/<llm>.md`, backs up affected files, regenerates outputs, and updates instruction sync state when exports run
- Summary: `sync` explains file moves, section routing, bucket assignment, and export targets; `--explain` adds downgrade and merge reasons
- Analyze: `analyze` is always read-only, lists discovered documents, settings, skills, and plugins first, and then groups prompts, settings, skills, and plugins into `common`, `similar`, `conflicts`, `host_only`, and `unknown` when requested
- Drift: managed targets are compared against regenerated expectations
- Conflict detection: if both `.harness/` and a project target changed since the last sync, `sync` reports a conflict instead of silently choosing one side
- Backup: non-dry-run syncs create a timestamped backup before writing
- Revert: restores a chosen backup snapshot without running plugin install or uninstall commands
- Git safety: repo-internal skill and agent exports stay Git-friendly by defaulting to managed copies instead of symlinks or junctions

## Development Workflow

- For every feature addition or bug fix, first add a reproducing unit test.
- Prefer the in-memory filesystem test backend for new scenario setup and coverage.
- Confirm the new test fails before changing production code.
- After changing production code, rerun the focused test and then the full test suite.
- Keep symlink and junction behavior in focused real-filesystem tests instead of the general virtual filesystem path.

## Trusted Publishing

`soft-harness` is configured for npm Trusted Publishing from GitHub Actions.

- Workflow: `.github/workflows/publish.yml`
- Package: `soft-harness`
- Owner: `softdaddy-o`
- Repository: `soft-harness`

The publish workflow runs `npm test` and publishes with provenance.

## License

MIT
