---
name: organize
description: "Organize current host settings and prompts using natural-language requests such as remembering a rule, showing the current state, sharing an MCP with another host, splitting host-specific settings, or cleaning up stale prompt, memory, skill, agent, or plugin entries. Use when the user wants to change real Claude Code or Codex state and decide the best way to organize it. By default, organize should work in small chat-based steps: show validation findings first, explain that displaced files will be backed up under `.harness/backups/`, and ask whether to review changes one by one or see the full organize plan first. Respect `--dry-run` by planning only and not writing files."
---

# Organize

Use this embedded reference directly. Codex plugin installs may provide only this `SKILL.md`, so do not depend on sibling reference files being present.

## Harness Reference

- Real host files are authoritative. `.harness/` is a reusable snapshot plus decision memory from the latest `analyze` or `organize` run.
- Use `.harness/` to remember prior decisions, evidence, and shared-vs-host-local reasoning so the same questions do not need to be asked twice.
- Snapshot layout:
  - `.harness/HARNESS.md` for guidance that appears shared across hosts
  - `.harness/llm/{claude,codex,gemini}.md` for host-specific prompt additions
  - `.harness/settings/portable.yaml` for settings that appear safe to share
  - `.harness/settings/llm/{claude,codex,gemini}.yaml` for host-specific settings or overrides
  - `.harness/skills/` and `.harness/agents/` buckets for common and host-specific assets
  - `.harness/memory/` for durable user memory and prior decision notes
  - `.harness/plugins.yaml`, `.harness/plugin-origins.yaml`, and `.harness/asset-origins.yaml` for plugin targeting and origin evidence
  - `.harness/.sync-state.json` and `.harness/backups/` as support state, not user-authored truth
- `analyze` may refresh `.harness` without mutating host files. `organize` should update real host files first, then refresh `.harness` to match the new state.
- Direct edits to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and host settings are allowed because those files are authoritative.
- Use deterministic helpers only for exact parsing, hashing, validation, apply or backup steps, and local evidence collection. Relevant helper areas are `src/profiles.js`, `src/discover.js`, `src/md-parse.js`, `src/section-match.js`, `src/analyze/settings.js`, `src/settings.js`, `src/plugins.js`, `src/skills.js`, `src/export.js`, `src/backup.js`, `src/revert.js`, `src/state.js`, `src/origins.js`, `src/asset-origins.js`, `src/plugin-origins.js`, `src/fs-util.js`, `src/hash.js`, and `src/fs-backend.js`.
- Helpers should not decide whether similar content should be merged, whether host-specific behavior should remain split, how to phrase user questions, final origin confidence when local evidence is incomplete, or memory placement when user intent is ambiguous.

## Workflow

1. Parse the user's natural-language intent.
2. Inspect the relevant host files first, then inspect the current `.harness` snapshot for prior decisions and recorded evidence when it exists.
3. If `.harness` does not exist yet, treat that as normal. Use the live host files as the starting point and plan the snapshot files that should be created after the host changes are done.
4. Use deterministic helpers where they are stronger than ad hoc reasoning:
   - prompt section parsing and similarity
   - settings parsing and MCP inventories
   - malformed settings or parse-error detection
   - host profile paths and apply targets
   - local origin hints for skills, agents, and plugins
5. Show validation findings before proposing edits.
6. Tell the user that any displaced host files will be backed up under `.harness/backups/`.
7. Start in chat mode by asking whether the user wants to review changes one by one or see the full organize plan first. Use this pattern by default:
   - `Do you want to go one by one, or see the full proposed organize plan first?`
8. Ask any additional follow-up questions only when the user intent is ambiguous or the merge/split decision has real semantic risk.
9. If not `--dry-run`, back up displaced host files first.
10. Update the real host files that the user actually uses.
11. Refresh or initialize `.harness` so it records the resulting snapshot, decisions, and origin notes.

## Settings And MCP Review

- Catch invalid or unsupported settings file formats when helpers can prove them.
- Flag malformed MCP definitions such as missing commands, unsupported shapes, parse errors, or host-only keys with no safe shared mapping.
- Show those validation findings to the user before asking for organize approval or review mode.
- Propose optimizations when they are defensible:
  - deduplicate identical MCP servers across hosts
  - align truly shared MCP definitions across hosts
  - keep risky vendor-specific keys host-local
  - normalize env passthrough names instead of persisting secret values
  - prune stale copies or obsolete overrides

## Codex Plugin Sync

- When a Claude-installed plugin is targeted to Codex and has a Codex plugin wrapper, ask the user to enable Codex plugins before mirroring the plugin bundle into Codex.
- If the user has not enabled Codex plugins yet, keep supporting the current fallback: port the Claude plugin's skills and agents into Codex skills and TOML agents.
- After the user enables Codex plugins, re-run sync with Codex plugins confirmed enabled so the Claude plugin is registered in the Codex marketplace and the fallback skill/agent ports are removed. The final state should match a first sync that used the Codex plugin from the start.
- Prefer a Git-backed Codex marketplace entry (`url` or `git-subdir`) when Claude plugin metadata proves a GitHub origin and plugin subdirectory. Fall back to a local Codex marketplace copy only when that origin cannot be proven.

## Memory And Rules

- Route durable memory and prior decisions into `.harness/memory/`.
- Use `.harness/HARNESS.md` and `.harness/llm/*.md` as a record of analyzed or organized host guidance, not as authoritative truth.
- Direct host edits are allowed, but prefer `organize` when the user wants coordinated multi-host changes or durable decision tracking.

## Dry Run

- In `--dry-run`, do not write files.
- Show the relevant current state, the validation findings, the proposed host changes, the `.harness` snapshot updates that would follow, and any unresolved semantic questions.
- In that explanation, explicitly mention that real writes would back up displaced files under `.harness/backups/`.
- Ask whether the user wants to review changes one by one or see the full organize plan first.
- If `.harness` is absent, show which snapshot files would be created after the host changes instead of assuming snapshot files already exist.
