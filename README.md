# soft-harness

`soft-harness` looks at the messy Claude Code and Codex setup you already have, shows you what is shared, host-specific, stale, or broken, and helps you clean it up.

The shared plugin core lives in [`plugins/soft-harness`](plugins/soft-harness) and exposes two skills:

- `analyze`: show the current state clearly
- `organize`: help clean it up safely

If your current setup feels scattered across `CLAUDE.md`, `AGENTS.md`, MCP settings, local skills, agents, and plugin files, `soft-harness` is meant to make that visible first, then help you sort it out.

## Quick Install

GitHub repository:

- `https://github.com/softdaddy-o/soft-harness`

Install into the repo you are currently working in.

### 1. Install your host app

- Claude Code: `npm install -g @anthropic-ai/claude-code`
- Codex CLI: `npm install -g @openai/codex`

### 2. Choose the install path

#### Claude Code

Claude Code supports GitHub-backed plugin marketplaces directly, so this is the preferred install flow:

```text
/plugin marketplace add softdaddy-o/soft-harness
/plugin install soft-harness@soft-harness
/reload-plugins
```

If `/plugin` is missing, update Claude Code first.

#### Codex

Codex currently documents repo-local and personal marketplaces rather than a public GitHub marketplace add command, so the simplest path here is the installer script.

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/softdaddy-o/soft-harness/main/scripts/install-plugin.sh | bash -s -- --host=codex
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/softdaddy-o/soft-harness/main/scripts/install-plugin.ps1))) -Host codex
```

After install, open Codex in the repo and use `/plugins` if you want to confirm the local marketplace entry.

#### Want both Claude Code and Codex in the same repo?

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/softdaddy-o/soft-harness/main/scripts/install-plugin.sh | bash -s -- --host=both
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/softdaddy-o/soft-harness/main/scripts/install-plugin.ps1))) -Host both
```

### What the installer does

- copies `plugins/soft-harness` into your current repo
- creates or updates the local plugin marketplace file for Codex and/or Claude Code
- preserves any existing plugin entries already in those marketplace files

### Requirements

- `git`
- `node`
- Claude Code and/or Codex already installed on your machine

### Use It

After installation, open your repo in Codex or Claude Code and ask:

```text
Use Soft Harness analyze to inspect this repo and show me what is shared, host-specific, stale, or broken.
```

or:

```text
Use Soft Harness organize to clean up this setup and keep .harness in sync.
```

The code under `src/` remains a **thin deterministic helper surface** for discovery, parsing, settings/MCP validation, local origin hints, host-file apply steps, backup, and debug workflows.

## Wrappers

The skill content is shared, but the plugin wrappers are host-specific.

- Claude Code wrapper:
  - marketplace: [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json)
  - plugin manifest: [`plugins/soft-harness/.claude-plugin/plugin.json`](plugins/soft-harness/.claude-plugin/plugin.json)
- Codex wrapper:
  - marketplace: [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json)
  - plugin manifest: [`plugins/soft-harness/.codex-plugin/plugin.json`](plugins/soft-harness/.codex-plugin/plugin.json)

## Product Model

- The real host files remain authoritative.
- `.harness/` is a reusable snapshot plus decision-memory layer.
- `analyze` inspects current host state, surfaces issues, and can refresh `.harness` without mutating host files.
- `organize` handles natural-language maintenance requests, applies changes to real host files, and then refreshes `.harness`.
- `--dry-run` means no writes.
- Plugin install and uninstall execution are out of scope.

## Important References

- docs entrypoint: [`docs/README.md`](docs/README.md)
- active architecture: [`docs/plugin-architecture.md`](docs/plugin-architecture.md)
- `.harness` snapshot rules: [`plugins/soft-harness/skills/references/harness-folder-rules.md`](plugins/soft-harness/skills/references/harness-folder-rules.md)
- retained deterministic helper surface: [`plugins/soft-harness/skills/references/helper-surface.md`](plugins/soft-harness/skills/references/helper-surface.md)

## Plugin Layout

```text
.claude-plugin/
  marketplace.json
.agents/plugins/
  marketplace.json
plugins/
  soft-harness/
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json
    skills/
      analyze/
      organize/
      references/
```

## `.harness` Layout

```text
.harness/
  HARNESS.md
  llm/
  settings/
  skills/
  agents/
  memory/
  plugins.yaml
  plugin-origins.yaml
  asset-origins.yaml
  .sync-state.json
  backups/
```

This folder is not the source of truth. It records the most recent analyzed or organized view of the host state plus the user's decisions.

## Thin Helper Surface

Keep deterministic code only where it materially helps the skills.

- discovery and host profiles
- prompt parsing and section similarity
- settings parsing and MCP inventories
- malformed settings detection
- local plugin, skill, and agent origin hints
- host-file apply helpers
- backup and revert primitives

## Virtual PC Test Fixture

The repository also contains a builder for a sanitized Windows-like fixture used to test `analyze` and `organize` with an LLM:

- builder: [`scripts/build-virtual-pc.js`](scripts/build-virtual-pc.js)
- implementation: [`src/virtual-pc.js`](src/virtual-pc.js)

## Development

```text
npm run eval:llm
npm run eval:llm:codex
npm run eval:skills
npm test
```

## LLM-In-The-Loop Eval Runs

Use the shipped scenario runner when you want to test `analyze` or `organize` through a real Claude Code or Codex session on the sanitized virtual PC fixture.

```text
node scripts/run-llm-eval.js list
node scripts/run-llm-eval.js prepare analyze-clean-start-dry-run
node scripts/run-llm-eval.js codex analyze-clean-start-dry-run
node scripts/run-llm-eval.js check sandbox/llm-eval-runs/<scenario-id>-<timestamp>
```

Each prepared run directory contains:

- `sandbox-root/`: mutable copy of the scenario root from the virtual PC
- `USER_PROMPT.md`: the exact prompt to send to the LLM
- `RUNBOOK.md`: operator steps for the real session
- `before-manifest.json`: deterministic baseline for post-checks
- `transcript.md`: place to paste the real-session transcript
- `check-report.json` and `check-report.md`: checker outputs after the run

The `codex` subcommand performs the full loop automatically for Codex:

- stages the local `soft-harness` plugin into the sandbox before the baseline manifest
- initializes a temporary git repo in the sandbox root
- runs `codex exec` with the scenario prompt
- saves `events.jsonl`, `transcript.md`, and the checker report in one pass
