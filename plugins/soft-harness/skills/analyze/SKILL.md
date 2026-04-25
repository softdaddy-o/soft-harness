---
name: analyze
description: "Inspect the current Claude Code and Codex state, compare prompts/settings/skills/agents/plugins, surface malformed MCP or settings issues, and capture a reusable snapshot of the current setup. Use when the user wants a read-only assessment, a current-state report, or a first-pass consolidation plan before making changes. When `analyze` recommends `organize`, it should show the validation findings and note that displaced files will be backed up under `.harness/backups/`. `analyze` never mutates host files. In `--dry-run`, it also leaves snapshot state untouched."
---

# Analyze

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
- Promote to shared only when semantics are actually shared, not just similar.
- Keep risky or vendor-specific settings host-local.
- Use deterministic helpers only for exact parsing, hashing, validation, apply or backup steps, and local evidence collection. Relevant helper areas are `src/profiles.js`, `src/discover.js`, `src/md-parse.js`, `src/section-match.js`, `src/analyze/settings.js`, `src/settings.js`, `src/plugins.js`, `src/skills.js`, `src/export.js`, `src/backup.js`, `src/revert.js`, `src/state.js`, `src/origins.js`, `src/asset-origins.js`, `src/plugin-origins.js`, `src/fs-util.js`, `src/hash.js`, and `src/fs-backend.js`.
- Helpers should not decide whether similar content should be merged, whether host-specific behavior should remain split, how to phrase user questions, final origin confidence when local evidence is incomplete, or memory placement when user intent is ambiguous.

## Workflow

1. Inspect the current host state before making any recommendations.
2. Use deterministic helpers for facts:
   - host profile paths
   - discovered instruction files
   - settings parse results and MCP inventories
   - malformed settings or parse-error detection
   - discovered skills, agents, plugins, and local origin hints
   - the prior `.harness` snapshot when it exists
3. If `.harness` does not exist yet, treat that as normal. Use the live host files as the only starting point and describe the snapshot files that would be created.
4. Start the report with an overall score out of 100 plus a short explanation of the main reasons behind that score.
   - The score reasons should explicitly call out LLM-specific settings conflicts or out-of-sync settings when they are present.
5. Summarize what is clearly shared, clearly host-specific, malformed, stale, or ambiguous.
6. Ask only the follow-up questions that require semantic judgment:
   - whether similar guidance should become shared
   - whether a plugin or MCP definition should stay host-local
   - whether origin evidence is strong enough to record
7. When organize is the recommended next step, show the validation findings first and tell the user that displaced files will be backed up under `.harness/backups/`.
8. Recommend a chat-based organize flow that starts by asking:
   - whether the user wants to review changes one by one
   - or see the full organize plan first
9. If not `--dry-run`, refresh or initialize `.harness` so it captures:
   - the current host snapshot
   - the user's prior decisions
   - origin evidence and confidence notes
   - enough context to avoid asking the same question again later

## Output

- report intro with an overall score out of 100 and the main reasons for it
- inventory of current prompts, settings, skills, agents, plugins, and memory candidates
- current shared-vs-host-local opportunities
- malformed MCP/settings findings
- safe optimization ideas
- when organize is recommended, the backup note for `.harness/backups/` and the suggested review mode question
- origin research hints for skills, agents, and plugins

## Dry Run

- In `--dry-run`, do not write files.
- Show the current inventory, the proposed `.harness` snapshot updates, unresolved questions, and recommended next actions.
- If `.harness` is absent, show the snapshot files that would be initialized instead of assuming they already exist.

## Origin Research

- Start with local evidence from manifests, cache metadata, package metadata, `.git`, README files, and known path conventions.
- Summarize that evidence before doing broader web research.
- When local evidence is incomplete, continue with GitHub or marketplace research and present confidence clearly to the user.
