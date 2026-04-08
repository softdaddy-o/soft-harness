# Schema v0

## Registry

`harness/registry.yaml` is the root registry file.

Additional fragments may be loaded from:

- `harness/registry.d/*.yaml`
- `harness/policies/**/*.yaml`

## Top-Level Keys

- `version`
- `meta`
- `imports`
- `defaults`
- `capabilities`
- `guides`
- `outputs`

## Policy Packs

Policy packs are normal registry fragments.

They typically live under:

- `harness/policies/shared/`
- `harness/policies/claude/`
- `harness/policies/codex/`

They can define any mergeable top-level keys:

- `defaults`
- `capabilities`
- `guides`
- `outputs`

Example:

```yaml
imports:
  - ./policies/shared/governance-baseline.yaml
  - ./policies/shared/project-stubs.yaml
  - ./policies/claude/account-stub.yaml
```

## Capabilities

Each capability entry should contain:

- `id`
- `kind`: `instruction | guide | skill | agent | plugin | mcp`
- `target`: `claude | codex | both`
- `scope`: `account | project`
- `management`: `generated | linked | external | discovered`

Optional:

- `truth.path`

## Guides

Guides live in:

- `harness/guides/shared/`
- `harness/guides/claude/`
- `harness/guides/codex/`

Guide entries may be:

```yaml
guides:
  shared:
    - shared/base.md
```

Or:

```yaml
guides:
  claude:
    - path: discovered/account-CLAUDE.md
      scope: account
```

## Outputs

Outputs define generated bundles and target apply paths.

Example:

```yaml
outputs:
  - id: project-codex-instructions
    target: codex
    scope: project
    guide_buckets:
      - shared
      - codex
    generated_path: ./generated/project/codex/AGENTS.generated.md
    apply_path: ../AGENTS.harness.md
    apply_mode: copy
    enabled: true
```

Preset example:

```yaml
outputs:
  - id: project-codex
    preset: project-codex-stub
  - id: project-claude
    preset: project-claude-stub
```

`apply_mode` values:

- `copy`
- `stub`

Supported presets:

- `project-codex-stub`
- `project-claude-stub`
- `account-claude-stub`
- `account-codex-stub`
- `project-mcp`

## Ignore Rules

Ignore patterns can be placed under `defaults.ignore`.

Example:

```yaml
defaults:
  ignore:
    doctor_paths:
      - "C:/Users/me/.claude/plugins/cache/*"
    migrate_paths:
      - "C:/Users/me/.claude/plugins/cache/temp_git_*"
```

These patterns are matched against both absolute paths and discovered relative paths.

Template variables are supported in ignore patterns:

- `{rootDir}`
- `{harnessRoot}`
- `{userHome}`

Example:

```yaml
defaults:
  ignore:
    doctor_paths:
      - '{userHome}/.claude/plugins/cache/*'
```

## MCP Capabilities

Registry-managed MCP capabilities use:

```yaml
capabilities:
  - id: demo-mcp
    kind: mcp
    target: both
    scope: project
    management: generated
    server_id: demo
    server:
      command: demo-server
```

These can be emitted through an MCP output preset such as `project-mcp`.
