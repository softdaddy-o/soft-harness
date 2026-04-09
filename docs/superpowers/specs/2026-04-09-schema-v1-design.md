# soft-harness Schema v1 Design

**Date:** 2026-04-09  
**Status:** Draft  
**Scope:** Schema v1 — breaking changes from v0, migration path included

---

## 1. Goals

1. **Harness is the single source of truth.** Every file Claude Code or Codex reads is either owned by harness or tracked by it. Nothing lives outside the registry by accident.
2. **Apply is always copy.** No stub indirection. Generated content is written directly to target paths.
3. **Discover scope is explicit.** Project and account discovery never mix.
4. **External plugins are tracked by install recipe, not file backup.** Known marketplaces produce install commands automatically; unknown ones surface as doctor warnings.
5. **Apply is safe by default.** Dry-run and diff before every write. Backup before every destructive overwrite.

---

## 2. What Changes from v0

| Area | v0 | v1 |
|------|----|----|
| `apply_mode` | `copy` or `stub` | `copy` only — stub removed |
| Intermediate `generated_path` | Required | Removed — write directly to `apply_path` |
| Discover scope | Mixed (project + account) | Explicit `--scope project\|account` |
| Plugin `management: external` | No source tracking | Requires `source` block; `install_cmd` auto-generated for known registries |
| `discover` output file | `state/discovered/latest.json` (permanent) | `state/discover-tmp.json` (deleted after migrate) |
| Apply safety | None | Dry-run default, diff output, conflict prompt, backup |
| Managed file marker | None | Comment header written to every applied file |

---

## 3. Registry Schema v1

### 3.1 Top-Level Structure

```yaml
version: 1                        # REQUIRED — was 0

meta:
  name: string
  description: string

defaults:
  secrets_policy: deny
  generated_files_policy: overwrite   # "stub" value removed
  vendor_install_policy: track-source  # renamed from previous
  guides_root: ./guides
  ignore:
    doctor_paths: []
    migrate_paths: []

imports:
  - ./registry.d/*.yaml

capabilities: []
guides:
  shared: []
  claude: []
  codex: []
outputs: []
```

### 3.2 Capability Schema

All v0 fields remain. v1 adds `source` and `install_cmd` for `management: external`.

```yaml
capabilities:
  - id: string
    kind: instruction | guide | skill | agent | plugin | mcp
    target: claude | codex | both
    scope: account | project
    management: generated | linked | external | discovered
    enabled: true                      # optional, default true

    # For management: external — NEW in v1
    source:
      registry: string                 # e.g. "claude-plugins-official"
      package: string                  # e.g. "superpowers"
      version: string                  # optional, e.g. "5.0.7"
    install_cmd: string | null         # auto-generated if source.registry is known

    # For management: linked or generated
    truth:
      path: string

    # For kind: mcp
    server_id: string
    server:
      command: string
      args: []
```

**install_cmd rules:**
- If `source.registry` matches a known registry → `install_cmd` is auto-generated at `generate` time and written to the registry file.
- If `source` is null or registry is unknown → `install_cmd` stays null. Doctor emits a warning: `"install_cmd missing for external capability {id}"`.
- `install_cmd` is **never populated by discover or migrate** — only by `generate` for known registries, or by the user directly.

### 3.3 Output Schema

`generated_path` and `apply_mode` are removed. Outputs write directly to `apply_path`.

```yaml
outputs:
  - id: string
    target: claude | codex | both
    scope: account | project
    content_type: guide-bundle | mcp-json
    guide_buckets: [shared, claude]    # for guide-bundle
    apply_path: string                 # required — write destination
    enabled: true                      # optional, default true
```

**Presets** (updated — no more stub variants):

| Preset | target | scope | content_type | apply_path |
|--------|--------|-------|--------------|------------|
| `project-claude` | claude | project | guide-bundle | `../CLAUDE.md` |
| `project-codex` | codex | project | guide-bundle | `../AGENTS.md` |
| `account-claude` | claude | account | guide-bundle | `{userHome}/.claude/CLAUDE.md` |
| `account-codex` | codex | account | guide-bundle | `{userHome}/AGENTS.md` |
| `project-mcp` | both | project | mcp-json | `../.mcp.json` |

Old preset names (`project-claude-stub`, `project-codex-stub`, etc.) are **removed**. Migration tool maps old names to new ones automatically.

### 3.4 Managed File Marker

Every file written by `apply` gets a header comment:

```
<!-- Managed by soft-harness v1. Edit guides under harness/ not here. -->
```

For JSON targets (`.mcp.json`): no marker is injected — Claude Code may not tolerate unknown top-level keys in `.mcp.json`. Instead, `doctor` detects management by checking if the output's `apply_path` is declared in the registry. If it is, the file is considered managed regardless of content.

`doctor` checks for this marker. A file at `apply_path` without the marker is flagged as `unmanaged` — apply will warn before overwriting.

---

## 4. Discover

### 4.1 Scope Separation

```bash
soft-harness discover --scope project    # scans {rootDir} only
soft-harness discover --scope account    # scans {userHome}/.claude and {userHome}/AGENTS.md
```

`soft-harness account discover` is an alias for `--scope account` (preserves v0 CLI shape).

Running `soft-harness discover` without `--scope` is an **error** in v1.

**Project scope scans:**
- `{rootDir}/AGENTS.md`
- `{rootDir}/CLAUDE.md`
- `{rootDir}/.mcp.json`
- `{rootDir}/.claude/settings.json`
- `{rootDir}/.claude/agents/*.md`
- `{rootDir}/.claude/skills/*/SKILL.md`

**Account scope scans:**
- `{userHome}/.claude/CLAUDE.md`
- `{userHome}/.claude/settings.json`
- `{userHome}/.claude/agents/*.md`
- `{userHome}/.claude/skills/*/SKILL.md`
- `{userHome}/.claude/plugins/cache/**` (vendor-cache only, not migrated)

### 4.2 Output File Lifecycle

`discover` writes to a scope-specific tmp file:
- `--scope project` → `harness/state/discover-project-tmp.json`
- `--scope account` → `harness/state/discover-account-tmp.json`

Both files are:
- **Temporary** — not git-tracked (add both to `.gitignore`)
- **Consumed by migrate** — migrate reads the relevant tmp file and deletes it after
- **Overwritten** on each discover run for that scope

If `migrate` is run without the relevant tmp file present, it errors: `"No discover output found. Run 'soft-harness discover --scope <scope>' first."`

There is no permanent discover report. The migrated state in `harness/registry.d/` and `harness/guides/` is the record of what was found.

### 4.3 Asset Classification (unchanged from v0)

| Class | Detection | Migrate behavior |
|-------|-----------|-----------------|
| `vendor-cache` | path contains `/plugins/cache/` | Not migrated — `management: external` capability created instead |
| `primary` | CLAUDE.md, AGENTS.md, settings, .mcp.json | Migrated to `harness/guides/` |
| `project-capability` | `.claude/agents/`, `.claude/skills/` under rootDir | Migrated to `harness/guides/` |
| `account-capability` | `.claude/agents/`, `.claude/skills/` under userHome | Migrated to `harness/guides/` |
| `transient` | path contains `/temp_git_` | Ignored |

---

## 5. Apply Safety

### 5.1 Default Behavior

`apply` always runs dry-run first, then prompts.

```
$ soft-harness apply

Planned changes:
  CLAUDE.md        overwrite  (managed ✓)
  AGENTS.md        overwrite  (managed ✓)
  .mcp.json        overwrite  (managed ✓)
  ../other.md      overwrite  ⚠ unmanaged file — not written by soft-harness

Proceed? [y/N/b (backup first)/s (skip unmanaged)]
```

Unmanaged files (missing the managed marker) are shown with `⚠` and require explicit confirmation.

### 5.2 Flags

```bash
soft-harness apply              # dry-run output + interactive prompt
soft-harness apply --dry-run    # diff only, no writes, no prompt
soft-harness apply --yes        # apply all managed files; still prompts for unmanaged
soft-harness apply --yes --force  # apply all including unmanaged (no prompt)
soft-harness apply --backup     # backup all targets before writing
```

### 5.3 Backup Format

```
harness/state/backups/
  2026-04-09T14-23-11/
    CLAUDE.md
    AGENTS.md
    manifest.json
```

`manifest.json`:
```json
{
  "timestamp": "2026-04-09T14:23:11Z",
  "reason": "apply --backup",
  "files": [
    { "original": "../CLAUDE.md", "backed_up_as": "CLAUDE.md" }
  ]
}
```

`restore` reads the latest manifest by default:
```bash
soft-harness restore                    # restore latest backup
soft-harness restore --timestamp 2026-04-09T14-23-11
```

---

## 6. Known Registries

`src/known-registries.js` defines install command templates for recognized marketplaces.

```javascript
{
  'claude-plugins-official': {
    install_cmd_template: 'claude plugin install {package}@{registry}',
    supports_version: true,
    version_separator: '@',  // package@registry@version? TBD per actual CLI
  },
  'claude-code-plugins': {
    install_cmd_template: 'claude plugin install {package}@{registry}',
    supports_version: false,
  },
}
```

`generate` resolves `install_cmd` for each `management: external` capability with a known `source.registry` and writes it back to the registry file.

New registries can be added by the user via the registry yaml directly (`install_cmd` manual entry) or by contributing to `known-registries.js`.

---

## 7. v0 → v1 Migration

### 7.1 Automatic Migration (soft-harness migrate-schema)

```bash
soft-harness migrate-schema        # dry-run by default
soft-harness migrate-schema --apply
```

What it does:
1. Reads `harness/registry.yaml` and all `registry.d/*.yaml`
2. Bumps `version: 0` → `version: 1`
3. Removes `generated_path` from all outputs
4. Renames `apply_mode: stub` → removes field (copy is now the only mode)
5. Renames old preset names to new names (e.g. `project-claude-stub` → `project-claude`)
6. Adds `source: null` and `install_cmd: null` to any `management: external` capability missing these fields
7. Backs up original files to `harness/state/backups/schema-v0-backup/`
8. Reports any outputs that used `generated_path` with a note that the path can be deleted

### 7.2 Incompatibility Warnings

`migrate-schema` warns and halts (without `--force`) if:
- An output has `apply_mode: stub` AND the `apply_path` file does not have the managed marker (user may have hand-edited the stub file — content would be lost)
- An output's `generated_path` file does not exist (generate was never run — apply would write empty content)

---

## 8. Command Summary (v1)

| Command | Scope | Description |
|---------|-------|-------------|
| `init` | project | Initialize `harness/` in current directory |
| `discover --scope project\|account` | — | Scan local state → `state/discover-tmp.json` |
| `migrate` | project | Propose registry entries from `discover-tmp.json`, then delete it |
| `approve` | project | Move proposals from `registry.d/discovered/` → `registry.d/approved-*.yaml` |
| `generate` | project | Build output content, resolve `install_cmd` for known registries |
| `diff` | project | Show what `apply` would change |
| `apply` | project | Write generated content to target paths (dry-run + prompt by default) |
| `doctor` | project | Check registry health, missing markers, null install_cmds |
| `restore` | project | Restore files from backup |
| `migrate-schema` | project | Upgrade `registry.yaml` from v0 to v1 |
| `account <cmd>` | account | Same commands scoped to `{userHome}` |

---

## 9. Out of Scope (v1)

- Account/project inheritance or merging — harnesses are fully independent
- Automatic sync on file-system changes (watch mode)
- Multi-machine sync
- GUI

---

## 10. Open Questions

- `install_cmd` exact format for `claude plugin install` — needs verification against actual Claude Code CLI syntax for versioned installs
- Whether `@import` in CLAUDE.md is worth supporting as an alternative apply mode in a future v1.1
