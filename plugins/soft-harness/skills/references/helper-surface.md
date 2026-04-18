# Thin Helper Surface

The plugin keeps the LLM-facing workflow in skills. Deterministic code stays narrow and should be used only for work that benefits from exact parsing, hashing, apply/backup steps, or local evidence collection.

## Keep These Helper Areas

- `src/profiles.js`
  - built-in host profiles and canonical host paths
- `src/discover.js`
  - deterministic discovery of instruction files
- `src/md-parse.js`
  - markdown section parsing for prompt inspection
- `src/section-match.js`
  - section similarity and grouping helpers
- `src/analyze/settings.js`
  - structured settings parsing, MCP extraction, parse-error detection, host-only key detection
- `src/settings.js`
  - merge snapshot settings, compare host settings, and apply organized settings back to host files when needed
- `src/plugins.js`
  - local plugin manifest reading, snapshot validation, drift checks, and local origin hints from Claude cache and manifests
- `src/skills.js`
  - skill and agent discovery, bucket planning, and apply helpers
- `src/export.js`
  - render or refresh host-facing instruction files when organize applies prompt changes
- `src/backup.js`, `src/revert.js`, `src/state.js`
  - backups and state tracking
- `src/origins.js`, `src/asset-origins.js`, `src/plugin-origins.js`
  - import and persist origin evidence found by the LLM
- `src/fs-util.js`, `src/hash.js`, `src/fs-backend.js`
  - basic deterministic utilities

## Treat As Internal Or Transitional

- `src/cli.js`
  - migration-era debug shell, not the primary user experience
- current CLI flows built around `sync`, `prompt`, or `remember`
  - keep available only as internal/debug helpers until the plugin migration is complete

## What The Skills Should Use Helpers For

- inventory of current host files and `.harness` state
- parsing and validating settings files, including MCP inventories
- spotting malformed MCP definitions or unsupported settings formats
- finding local origin hints before asking the LLM to research GitHub or marketplaces
- applying prompt or settings changes to real host files
- refreshing `.harness` after analyze or organize
- backing up displaced host files before replacement

## What Helpers Should Not Decide

- whether similar content should be merged into shared truth
- whether host-specific behavior should remain split
- how to phrase user questions
- final origin confidence when local evidence is incomplete
- memory placement when the user intent is ambiguous
