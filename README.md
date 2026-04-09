# soft-harness

`soft-harness` is a governance-first harness for Claude and Codex environments.

It aims to provide a single source of truth for:

- instructions
- skills
- agents
- plugins
- MCP servers

Across two scopes:

- account-wide, per OS user
- project-wide

## Status

Working prototype, now on schema `v1`.

The current goal is to support:

- discovery of current Claude and Codex state
- migration of unorganized local state into a structured registry
- generation of host-native outputs from a single registry
- drift detection and cleanup
- explicit output definitions for direct apply targets
- reusable policy packs and example registries

## Principles

- Single truth is the Harness registry.
- Generated files are outputs, not hand-edited truth.
- Vendor-native installation flows stay vendor-native.
- Secrets stay local and out of tracked project config.
- Governance and cleanup come before automation.

## Installation

Prerequisites:

- Node.js 20+ recommended
- Git

Clone the repository and install dependencies:

```text
git clone https://github.com/softdaddy-o/soft-harness.git
cd soft-harness
npm install
```

Run the CLI from the repository:

```text
node src/cli.js help
```

Optional: install the CLI into your user environment with `npm link`:

```text
npm link
soft-harness help
```

To use `soft-harness` in another project:

1. Copy or create a `harness/` folder in that project.
2. Start from [examples/project-starter/harness/registry.yaml](D:/srcp/soft-harness/examples/project-starter/harness/registry.yaml) or [examples/full-governance/harness/registry.yaml](D:/srcp/soft-harness/examples/full-governance/harness/registry.yaml).
3. Run `soft-harness discover --scope project`, `soft-harness doctor`, and `soft-harness generate`.

If you do not want a global CLI install, you can also run it directly from this repo with an explicit path:

```text
node D:\srcp\soft-harness\src\cli.js help
```

## Trusted Publishing

`soft-harness` is set up for npm Trusted Publishing from GitHub Actions.

Workflow file:

- [.github/workflows/publish.yml](D:/srcp/soft-harness/.github/workflows/publish.yml)

What you still need to do in npm:

1. Open the npm package settings for `soft-harness`.
2. Add a Trusted Publisher for GitHub Actions.
3. Use these values:
   - owner: `softdaddy-o`
   - repository: `soft-harness`
   - workflow file: `publish.yml`
   - environment: leave empty unless you later protect it with a GitHub Environment

After that, you can publish without storing an npm token by:

1. creating a GitHub release, or
2. running the `Publish to npm` workflow manually from the Actions tab

The workflow will:

- install dependencies
- run `npm test`
- publish with `--provenance`

Trusted Publishing is the preferred long-term path over a bypass-2FA token.

## Commands

```text
soft-harness init
soft-harness discover --scope project|account
soft-harness doctor
soft-harness preview
soft-harness migrate
soft-harness migrate-schema [--apply] [--force]
soft-harness generate
soft-harness diff
soft-harness apply [--dry-run] [--yes] [--force] [--backup]
soft-harness approve [proposal-dir]
soft-harness restore [backup-id]
soft-harness account discover
```

## Current MVP

- registry loading and validation
- `registry.d` fragment support
- guide buckets for shared, Claude-only, and Codex-only content
- scoped discovery to `harness/state/discover-project-tmp.json` and `harness/state/discover-account-tmp.json`
- doctor checks for registry issues, unmanaged assets, and possible plaintext secrets
- doctor warnings for unmanaged apply targets and missing external `install_cmd`
- preview command for combined registry, discovery, proposal, diff, and apply state
- grouped migration proposal generation under `harness/registry.d/discovered/`
- migration backups under `harness/state/backups/`
- direct output generation to `apply_path` targets
- apply dry-run preview, force/backup support, and managed-file marker ownership
- account-wide and project-wide output presets
- generated MCP JSON outputs from registry-managed MCP capabilities
- known registry install command resolution for external plugins
- approve command to promote grouped migration proposals into active `registry.d` files
- restore command for migration backups
- ignore rules for doctor and migrate noise reduction
- `migrate-schema` command to upgrade `version: 0` registries to `version: 1`
- reusable policy packs under `harness/policies/`
- example registries under `examples/`

## Quick Start

Start from `harness/registry.yaml` and import reusable policy packs:

```yaml
version: 1

imports:
  - ./registry.d/*.yaml
  - ./policies/shared/governance-baseline.yaml
  - ./policies/shared/project-stubs.yaml
  - ./policies/shared/project-mcp.yaml

guides:
  shared:
    - path: common/project.md
      scope: project
  claude:
    - path: claude/review.md
      scope: project
  codex:
    - path: codex/build.md
      scope: project

capabilities: []
outputs: []
```

Then run:

```text
soft-harness init
soft-harness discover --scope project
soft-harness preview
soft-harness migrate
soft-harness approve
soft-harness generate
soft-harness apply
soft-harness doctor
```

For existing `version: 0` registries, dry-run the schema upgrade first:

```text
soft-harness migrate-schema
soft-harness migrate-schema --apply
```

## Schema v1 Highlights

- `apply_mode: stub` is removed. Outputs write directly to `apply_path`.
- `generated_path` is removed. There is no `harness/generated/` apply stage anymore.
- `discover` requires an explicit `--scope project|account`.
- `migrate` consumes the matching tmp discover file and deletes it after proposal generation.
- Guide bundle outputs are written with a managed marker:

```text
<!-- Managed by soft-harness v1. Edit guides under harness/ not here. -->
```

- `.mcp.json` outputs do not get a marker. They are considered managed by registry declaration.
- External plugin capabilities can track a `source` block and get `install_cmd` auto-filled for known registries during `generate`.

## Common Flow

For a new or existing project:

```text
soft-harness init
soft-harness discover --scope project
soft-harness preview
soft-harness migrate
soft-harness approve
soft-harness generate
soft-harness diff
soft-harness apply
soft-harness doctor
```

For account-level Claude/Codex state:

```text
soft-harness account discover
soft-harness migrate --scope account
soft-harness generate
soft-harness apply
```

`apply` behavior:

- `soft-harness apply` shows a dry-run preview, then prompts before writing
- `soft-harness apply --dry-run` only previews changes
- `soft-harness apply --yes` skips the prompt for managed targets
- `soft-harness apply --force` takes ownership of unmanaged targets
- `soft-harness apply --backup` stores target backups in `harness/state/backups/`

`preview` behavior:

- shows registry/import/output counts
- shows live discovery counts without writing discover tmp files
- shows pending proposal summary from `harness/registry.d/discovered/`
- shows doctor warning/error totals
- shows diff status summary
- shows apply dry-run status summary
- `soft-harness preview --verbose` also prints the full asset, proposal, doctor, diff, and apply item lists

## Layout

```text
harness/
  registry.yaml
  registry.d/
  guides/
    shared/
    claude/
    codex/
  policies/
  state/
src/
```

`harness/` is the home for user-managed truth.

That includes:

- registry files
- shared guides
- Claude-only guides
- Codex-only guides
- policy fragments
- reusable policy packs
- migration state and backups

`harness/state/` is operational state, not truth. In v1 that includes:

- scoped discover tmp files
- backup manifests and restored file payloads

## License

MIT
