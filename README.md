# soft-harness

## Introduction

`soft-harness` helps you analyze and organize the messy AI-related settings already scattered across your repo, including `CLAUDE.md`, `AGENTS.md`, MCP settings, local skills, agents, and plugins.

The shared plugin core lives in [`plugins/soft-harness`](plugins/soft-harness) and exposes two skills:

- `analyze`: show the current state clearly
- `organize`: help clean it up safely

If your setup feels scattered or hard to reason about, start with `analyze`, then use `organize` to clean it up safely.

## Easiest Start: Claude Code

If you want the fastest path, install through the Claude Code marketplace in the repo you want to inspect.

1. Install Claude Code:

```bash
npm install -g @anthropic-ai/claude-code
```

2. In Claude Code, run:

```text
/plugin marketplace add softdaddy-o/soft-harness
/plugin install soft-harness@soft-harness
/reload-plugins
```

3. Then ask Claude Code:

```text
Use Soft Harness analyze to inspect this repo and show me what is shared, host-specific, stale, or broken.
```

When it recommends `organize`, it should show the validation results first, tell you that displaced files will be backed up under `.harness/backups/`, and start in chat mode by asking whether you want to review changes one by one or see a full organize plan first.

If `/plugin` is missing, update Claude Code first.

## Other Setup And Use

GitHub repository:

- `https://github.com/softdaddy-o/soft-harness`

### Codex

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

### Want both Claude Code and Codex in the same repo?

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
Use Soft Harness organize to show the validation results, tell me what will be backed up in .harness/backups/, and ask whether I want to review changes one by one or see the full organize plan first.
```

By default, `organize` should work in small chat-based steps. It should ask how you want to review the work first, such as:

```text
Do you want to go one by one, or see the full proposed organize plan first?
```

The code under `src/` remains a **thin deterministic helper surface** for discovery, parsing, settings/MCP validation, local origin hints, host-file apply steps, backup, and debug workflows.

### Give This To An LLM

If your LLM can read repository files directly, give it this prompt:

```text
Read these files first, in order:
1. README.md
2. docs/plugin-architecture.md
3. plugins/soft-harness/skills/analyze/SKILL.md
4. plugins/soft-harness/skills/organize/SKILL.md

Then inspect the current repository and help me with this task:
[describe your task here]

Constraints:
- Treat README.md as the primary product guide.
- Treat docs/superpowers as historical context unless needed for rationale.
- Do not invent product behavior that is not supported by the current repo.
- If behavior is unclear, quote the file path that supports your conclusion.
```

If your LLM cannot read repo files directly, attach or paste at least these files:

- `README.md`
- `docs/plugin-architecture.md`
- `plugins/soft-harness/skills/analyze/SKILL.md`
- `plugins/soft-harness/skills/organize/SKILL.md`

Then use this prompt:

```text
Use the attached README and skill docs as the authoritative context for this repository.
Follow the documented product model and workflow instead of making assumptions.
If the docs conflict, prioritize README.md first, then current skill docs, then architecture docs.

Task:
[describe your task here]
```

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
