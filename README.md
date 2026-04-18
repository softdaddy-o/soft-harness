# soft-harness

`soft-harness` is a **plugin-first workflow** for Claude Code and Codex.

The shared plugin core lives in [`plugins/soft-harness`](plugins/soft-harness) and exposes two skills:

- `analyze`
- `organize`

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
