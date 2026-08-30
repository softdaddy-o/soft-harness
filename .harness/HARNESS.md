Repository instructions shared across hosts for `soft-harness`.

## Purpose

This repository defines a plugin-first workflow for analyzing and organizing real Claude Code and Codex state while keeping `.harness` as a reusable snapshot and decision-memory layer.

The product scope is:

- keep shared plugin content under `plugins/soft-harness/`
- provide `analyze` and `organize` skills through Claude and Codex wrappers
- keep `.harness/` as the latest analyzed or organized snapshot of prompts, settings, skills, agents, plugins, and memory
- use thin deterministic helpers in `src/` only for parsing, apply, backup, and local evidence collection

It is not:

- an agent runtime
- an MCP server
- a plugin installer
- a plugin marketplace
- a secret manager

## Product Rules

- Real host files are the source of truth.
- `.harness/` stores snapshot state, prior decisions, and memory so later runs do not need to rediscover everything.
- `analyze` may refresh `.harness` without mutating host files.
- `organize` should update host files first and then refresh `.harness`.
- Memory should live under `.harness/memory/`.
- Shared settings should live under `.harness/settings/portable.yaml`.
- Host-specific settings should live under `.harness/settings/llm/<host>.yaml`.
- Plugin install and uninstall execution are out of scope.
- Secrets must never be committed.

## Releasing

Publishing runs in GitHub Actions, not from a developer machine. The package
uses npm **trusted publishing** (OIDC), which only works inside the workflow:
the short-lived identity token comes from the CI runner, so a local
`npm publish` has nothing to present and falls back to demanding 2FA. A stored
token in `~/.npmrc` does not change this. If you find yourself entering an OTP,
you are on the wrong path.

Release steps:

1. bump `version` in `package.json`, then `npm run version` to propagate it to
   the plugin manifests
2. `node scripts/sync-plugin-src.js` so the plugin carries the current runtime
   graph, and `npm test`
3. commit and push to `main`
4. publish by either
   - `gh workflow run publish.yml --ref main`, or
   - creating a GitHub Release tagged `v<version>`

The trusted publisher is registered on npmjs.com as
`softdaddy-o/soft-harness` + `publish.yml`. Changing the workflow's filename
breaks publishing until that registration is updated.

Verify with `curl -s https://registry.npmjs.org/soft-harness` rather than
`npm view` — the latter serves a local cache and will show the previous version
for a while after a successful publish.

Two distribution channels exist and drift silently: the npm package and the
Claude plugin (installed from the GitHub marketplace entry). A publish updates
only npm; the plugin needs `/plugin marketplace update soft-harness` and
`/reload-plugins` on each machine.

## Code Style

### JavaScript

- Use CommonJS unless a file already uses ESM.
- Use 4-space indentation.
- Use single quotes.
- Use semicolons.
- Keep functions small and explicit.

### YAML

- Prefer explicit keys over compact syntax.
- Keep examples realistic and minimal.

### Markdown

- Keep design docs concise and structured.
- Prefer concrete examples over abstract prose.
