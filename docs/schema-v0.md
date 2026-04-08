# Schema v0

## Registry

`harness/registry.yaml` is the root registry file.

Additional fragments may be loaded from:

- `harness/registry.d/*.yaml`

## Top-Level Keys

- `version`
- `meta`
- `imports`
- `defaults`
- `capabilities`
- `guides`
- `outputs`

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
