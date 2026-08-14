# Project-Scoped Codex HTTP MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import project HTTP MCP definitions into the harness snapshot and render authoritative, stale-free project Codex MCP sections without breaking stdio or override behavior.

**Architecture:** Extend the shared normalized server shape with `url`, then add a focused settings importer used by `runSync` before settings export. Project `.mcp.json` is authoritative when present; otherwise project `.codex/config.toml` supplies definitions and overrides. Codex export continues replacing only the managed TOML subtree.

**Tech Stack:** Node.js 20 CommonJS, `node:test`, `yaml`, existing filesystem abstraction.

---

## File Map

- Modify `src/analyze/settings.js`: preserve URLs, recognize URL-only definitions, and expose normalized definitions with source scope.
- Modify `src/settings.js`: normalize/render URLs and import project MCP settings into Codex harness YAML.
- Modify `src/sync.js`: invoke settings import before settings export and report its route.
- Modify `test/analyze.test.js`: cover URL-only TOML analysis and project scope.
- Modify `test/settings.test.js`: cover HTTP JSON import, snapshot replacement, HTTP TOML export, stale removal, and compatibility.
- Modify `test/sync.test.js`: cover the complete project `.mcp.json` to Codex config synchronization path.

### Task 1: Analyze URL-Only MCP Definitions

**Files:**
- Modify: `test/analyze.test.js`
- Modify: `src/analyze/settings.js`

- [ ] **Step 1: Write the failing analysis test**

Add a test that creates `.codex/config.toml` containing `[mcp_servers.unreal-mcp]` and `url = "http://127.0.0.1:8000/mcp"`, runs `runAnalyze` for Codex settings, and asserts the project inventory lists `unreal-mcp` under `mcpServers` rather than `mcpOverrides`.

- [ ] **Step 2: Verify the test fails**

Run: `node --test test/analyze.test.js --test-name-pattern="URL-only"`

Expected: FAIL because `hasFullMcpDefinition` does not recognize `url` or the normalized definition omits it.

- [ ] **Step 3: Add URL normalization**

In `buildMcpServer`, add:

```js
url: value.url ? String(value.url) : '',
```

In `hasFullMcpDefinition`, include `value.url` in the full-definition predicate. Keep `transport` defaulting to `stdio` only when no URL transport signal exists; normalize URL definitions consistently so equal JSON and TOML definitions hash equally.

- [ ] **Step 4: Verify analysis tests pass**

Run: `node --test test/analyze.test.js test/analysis-internals.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/analyze/settings.js test/analyze.test.js test/analysis-internals.test.js
git commit -m "feat: analyze URL-based MCP definitions"
```

### Task 2: Import and Reconcile Project MCP Settings

**Files:**
- Modify: `test/settings.test.js`
- Modify: `src/settings.js`

- [ ] **Step 1: Write failing import tests**

Add tests for an exported `importProjectSettings(rootDir, options)` function. The first fixture has `.mcp.json` with `type: "http"` and a URL and asserts `.harness/settings/llm/codex.yaml` contains:

```yaml
version: 1
mcp_servers:
  unreal-mcp:
    scope: project
    transport: http
    url: http://127.0.0.1:8000/mcp
    enabled_for:
      - codex
```

The second fixture starts with a stale server in the Codex harness YAML, imports a replacement `.mcp.json`, and asserts only the replacement remains. A third fixture supplies only `.codex/config.toml` and asserts full definitions and enable-only overrides are stored separately.

- [ ] **Step 2: Verify import tests fail**

Run: `node --test test/settings.test.js --test-name-pattern="importProjectSettings"`

Expected: FAIL because `importProjectSettings` is not exported.

- [ ] **Step 3: Implement parsing and snapshot replacement**

Add `importProjectSettings` and small helpers in `src/settings.js`:

```js
function importProjectSettings(rootDir, options) {
    const jsonPath = path.join(rootDir, '.mcp.json');
    const codexPath = path.join(rootDir, '.codex', 'config.toml');
    const source = exists(jsonPath)
        ? parseProjectMcpJson(readUtf8(jsonPath))
        : exists(codexPath)
            ? parseProjectCodexToml(readUtf8(codexPath))
            : null;
    if (!source) {
        return { imported: [], routes: [] };
    }
    return writeCodexProjectSnapshot(rootDir, source, options);
}
```

Normalize `type: "http"` to `transport: "http"`, retain `url`, add `scope: "project"` and `enabled_for: ["codex"]`, and replace the prior project `mcp_servers` and `mcp_server_overrides` maps atomically. Parse before writing so malformed input leaves the prior snapshot untouched. Honor `dryRun` by reporting without writing.

- [ ] **Step 4: Verify import tests pass**

Run: `node --test test/settings.test.js --test-name-pattern="importProjectSettings"`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/settings.js test/settings.test.js
git commit -m "feat: import project MCP settings"
```

### Task 3: Export HTTP Definitions and Remove Stale TOML Sections

**Files:**
- Modify: `test/settings.test.js`
- Modify: `src/settings.js`

- [ ] **Step 1: Write the failing export test**

Create Codex harness YAML containing a project HTTP server and a `.codex/config.toml` containing unrelated keys plus a stale stdio server. Assert export preserves unrelated content, emits only:

```toml
[mcp_servers.unreal-mcp]
url = "http://127.0.0.1:8000/mcp"
```

for the HTTP definition, and removes the stale section. Retain the existing stdio and override assertions.

- [ ] **Step 2: Verify the export test fails**

Run: `node --test test/settings.test.js --test-name-pattern="HTTP definitions"`

Expected: FAIL because URL is discarded and empty stdio fields are rendered.

- [ ] **Step 3: Implement transport-aware rendering**

Extend `normalizeHarnessServer` with `scope` and `url`. In `renderTomlSettings`, render `url` when present and do not render `transport`, `command`, or `args` for URL-only definitions. Keep the existing stdio block unchanged. Extend JSON rendering to preserve `url` and map HTTP transport to the host-compatible `type` field where applicable.

- [ ] **Step 4: Verify settings tests pass**

Run: `node --test test/settings.test.js`

Expected: PASS, including existing stdio, unrelated TOML, stale removal, and override tests.

- [ ] **Step 5: Commit**

```powershell
git add src/settings.js test/settings.test.js
git commit -m "feat: export Codex HTTP MCP definitions"
```

### Task 4: Integrate Settings Import into Sync

**Files:**
- Modify: `test/sync.test.js`
- Modify: `src/sync.js`

- [ ] **Step 1: Write the failing end-to-end sync test**

Create a project with `.mcp.json` containing `unreal-mcp`, stale Codex harness YAML, and `.codex/config.toml` containing stale MCP plus unrelated TOML. Run `runSync(root, { yes: true })` and assert the harness YAML and Codex TOML contain `unreal-mcp`, neither contains the stale server, and unrelated TOML remains.

- [ ] **Step 2: Verify the sync test fails**

Run: `node --test test/sync.test.js --test-name-pattern="project HTTP MCP"`

Expected: FAIL because sync does not import settings.

- [ ] **Step 3: Wire the importer into sync**

Import `importProjectSettings` from `src/settings.js`. In the existing `!noImport` phase, call it after instruction and skill imports, then append `imported` and `routes` to the same result collections. This ensures export consumes the newly reconciled snapshot in the same sync.

- [ ] **Step 4: Verify focused and full tests**

Run: `node --test test/sync.test.js test/settings.test.js test/analyze.test.js test/analysis-internals.test.js`

Expected: PASS.

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 5: Commit**

```powershell
git add src/sync.js test/sync.test.js
git commit -m "feat: sync project Codex HTTP MCP settings"
```

### Task 5: Final Verification and Worktree Audit

**Files:**
- Verify: all changed files

- [ ] **Step 1: Check formatting and diff hygiene**

Run: `git diff main...HEAD --check`

Expected: no output and exit code 0.

- [ ] **Step 2: Run the complete suite from a clean worktree**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Inspect branch and worktree state**

Run: `git status --short --branch`

Expected: clean `issue-20-project-http-mcp` branch.

Run: `git worktree list --porcelain`

Expected: main worktree plus the active issue 20 worktree, with no detached temporary worktrees.

