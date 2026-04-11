# Harness Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite soft-harness around a `.harness/` single source of truth with one `sync` command that consolidates instructions, skills, agents, and plugins.

**Spec:** `docs/superpowers/specs/2026-04-10-harness-refactor-design.md`

**Architecture:** Clean break from v0.2.3's registry-based schema. New tree in `src/` organized by single-responsibility modules. Tests use Node's built-in `node:test`. CLI dispatches to `sync` and `revert` commands. `sync` orchestrates discover → import → export → drift / plugin actions with shared utilities (profiles, fs, hashing, state, prompts).

**Tech Stack:** Node.js ≥20, CommonJS, `yaml` package (existing dep), `node:test` + `node:assert/strict`. No new runtime deps.

**Conventions (from `.claude/CLAUDE.md`):**
- 4-space indentation, single quotes, semicolons
- CommonJS `require` (not ESM)
- camelCase variables/functions, UPPER_SNAKE_CASE constants
- Status logging with `✓`, `❌`, `⚠️` emoji markers
- Async/await over promise chains
- KST timestamps via local time, not `toISOString()`

---

## Phase Roadmap

The refactor ships in five phases. Each phase produces working, testable software and can be shipped independently.

| Phase | Deliverable | Tests | Shippable? |
|---|---|---|---|
| **1. Core Sync (Instructions)** | `sync` + `revert` work end-to-end for root instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`). Wholesale move, no common extraction yet. Backups, drift detection, revert. | Unit + E2E | Yes — v0.3.0-alpha |
| **2. Common Extraction + Pull-back** | Section-level `HARNESS.md` extraction during import. Drift pull-back to correct source file. `--manual-review` mode. | Unit + E2E | Yes — v0.3.0-beta |
| **3. Skills & Agents** | Copy+marker default for repo-internal exports, with explicit opt-in link modes. Discovery and bucket classification. | Unit + E2E (fs-dependent) | Yes — v0.3.0-rc |
| **4. Plugins** | `plugins.yaml` parse, install/uninstall execution, drift detection against LLM plugin manifests. | Unit + command mocks | Yes — v0.3.0 |
| **5. Dogfood + Ship** | Run `sync` against soft-harness repo itself. Delete legacy `harness/`. Update README and docs. Publish v0.3.0. | Manual + release checks | Ships |

**Handoff order**: Phases depend linearly — each assumes the previous is complete and on `main`. A phase can be paused and resumed later without breaking the shipped feature set from prior phases.

**Within each phase**, Phase 1 is spelled out step-by-step with full TDD cycles and complete code. Phases 2–5 are task-level: each task lists files, purpose, and test cases. Engineers use Phase 1 as the style/structure template for steps in later phases.

---

## File Structure (Target End State)

```
src/
  cli.js               # entry, argv parsing, command dispatch
  profiles.js          # built-in LLM profiles (claude, codex, gemini)
  fs-util.js           # fs helpers (adapted from existing)
  md-parse.js          # markdown section parser (heading-based)
  hash.js              # sha256 hashing for sections and directories
  prompt.js            # interactive Y/N, selection, classify
  state.js             # .harness/.sync-state.json read/write
  backup.js            # .harness/backups/<timestamp>/ + manifest
  discover.js          # walk project, match profiles, classify
  import.js            # project → .harness/ direction
  stubs.js             # stub generation (import-stub + concat-stub)
  export.js            # .harness/ → project direction (uses stubs)
  drift.js             # drift detection for instructions
  sync.js              # sync command orchestrator + flag handling
  revert.js            # revert command

  # Added in Phase 2:
  extract.js           # common-content extraction heuristic
  pullback.js          # drift pull-back logic

  # Added in Phase 3:
  symlink.js           # platform symlink abstraction
  skills.js            # skills/agents discovery + bucket handling

  # Added in Phase 4:
  plugins.js           # plugins.yaml + install/uninstall runner

test/
  <matching .test.js for each src file>
  fixtures/
    <fixture project trees for E2E tests>
```

**Design rules:**
- Each `src/*.js` file has one responsibility. When a file grows past ~300 lines, split it.
- Test files mirror src file names: `src/discover.js` → `test/discover.test.js`.
- Fixtures go under `test/fixtures/<scenario-name>/` as real directory trees.
- Avoid `fs-extra` or any dep-heavy helpers. Use built-in `fs`.

---

# PHASE 1 — Core Sync (Instructions)

**Goal:** After Phase 1, running `soft-harness sync` in any project will:

1. Discover root instruction files (`CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.claude/CLAUDE.md`)
2. Prompt the user to classify ambiguous files
3. Move them wholesale into `.harness/llm/<name>.md` (no common-content extraction yet — `HARNESS.md` starts empty)
4. Regenerate the root files as stubs (import-stub or concat-stub per LLM profile)
5. Write `.harness/.sync-state.json` and `.harness/.gitignore`
6. Back up all touched files under `.harness/backups/<timestamp>/`
7. Detect drift on subsequent runs and warn (pull-back is Phase 2)
8. `soft-harness revert <timestamp>` restores any backup

**Scope explicitly excluded from Phase 1:** common extraction, drift pull-back, skills, agents, plugins, `--manual-review` mode.

---

## Task 1: Clean break — delete legacy code

**Files:**
- Delete: `src/account.js`, `src/apply.js`, `src/approve.js`, `src/backup.js`, `src/diff.js`, `src/discover.js`, `src/doctor.js`, `src/generate.js`, `src/known-registries.js`, `src/match.js`, `src/migrate-schema.js`, `src/migrate.js`, `src/presets.js`, `src/preview.js`, `src/project.js`, `src/registry.js`, `src/workspaces.js`
- Keep: `src/cli.js` (rewritten in Task 2), `src/fs-util.js` (adapted in Task 5)
- Delete: all `test/*.test.js` files and `test/fixtures/`
- Delete: `harness/` (legacy registry tree, no longer used)

- [ ] **Step 1: Move legacy files to trash**

```bash
trash src/account.js src/apply.js src/approve.js src/backup.js src/diff.js src/discover.js src/doctor.js src/generate.js src/known-registries.js src/match.js src/migrate-schema.js src/migrate.js src/presets.js src/preview.js src/project.js src/registry.js src/workspaces.js
trash test/
trash harness/
```

- [ ] **Step 2: Verify src/ contains only cli.js and fs-util.js**

```bash
ls src/
```

Expected output:
```
cli.js
fs-util.js
```

- [ ] **Step 3: Commit the teardown**

```bash
git add -A
git commit -m "chore: clean break — remove schema v1 code and tests"
```

---

## Task 2: Minimal CLI scaffold

**Files:**
- Modify: `src/cli.js` (full rewrite)

- [ ] **Step 1: Write failing test for `cli.js help`**

Create `test/cli.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

test('cli: help lists sync and revert', () => {
    const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /soft-harness sync/);
    assert.match(result.stdout, /soft-harness revert/);
});

test('cli: unknown command exits non-zero', () => {
    const result = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/i);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/cli.test.js`
Expected: tests fail because current cli.js references deleted modules.

- [ ] **Step 3: Rewrite `src/cli.js`**

Replace full contents:

```javascript
#!/usr/bin/env node

const HELP = `soft-harness — single source of truth for LLM harness files

Commands:
  soft-harness sync [options]         Reconcile .harness/ with the project (both directions)
  soft-harness revert --list          List available backups
  soft-harness revert <timestamp>     Restore files from the named backup
  soft-harness help                   Show this message

Sync options:
  --manual-review                     Confirm each change interactively
  --dry-run                           Report planned changes, write nothing
  --no-import                         Skip project → .harness direction
  --no-export                         Skip .harness → project direction
  --no-run-installs                   Files only, skip plugin installs
  --no-run-uninstalls                 Files only, skip plugin uninstalls
`;

function main(argv) {
    const command = argv[2] || 'help';

    switch (command) {
        case 'help':
        case '--help':
        case '-h':
            process.stdout.write(HELP);
            return 0;
        case 'sync':
            return runSync(argv.slice(3));
        case 'revert':
            return runRevert(argv.slice(3));
        default:
            process.stderr.write(`unknown command: ${command}\n${HELP}`);
            return 1;
    }
}

function runSync(_args) {
    process.stdout.write('sync: not yet implemented\n');
    return 0;
}

function runRevert(_args) {
    process.stdout.write('revert: not yet implemented\n');
    return 0;
}

if (require.main === module) {
    process.exit(main(process.argv));
}

module.exports = { main };
```

- [ ] **Step 4: Run test and verify it passes**

Run: `npm test -- test/cli.test.js`
Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: minimal cli scaffold with sync/revert dispatch"
```

---

## Task 3: LLM profiles module

**Files:**
- Create: `src/profiles.js`
- Create: `test/profiles.test.js`

- [ ] **Step 1: Write failing test**

Create `test/profiles.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES, getProfile, matchInstructionFile, listProfiles } = require('../src/profiles');

test('profiles: listProfiles returns claude, codex, gemini', () => {
    const names = listProfiles();
    assert.deepEqual(names.sort(), ['claude', 'codex', 'gemini']);
});

test('profiles: getProfile returns full profile object', () => {
    const claude = getProfile('claude');
    assert.equal(claude.name, 'claude');
    assert.equal(claude.supports_imports, true);
    assert.deepEqual(claude.instruction_files, ['CLAUDE.md', '.claude/CLAUDE.md']);
});

test('profiles: matchInstructionFile identifies exact matches', () => {
    assert.deepEqual(matchInstructionFile('CLAUDE.md'), ['claude']);
    assert.deepEqual(matchInstructionFile('.claude/CLAUDE.md'), ['claude']);
    assert.deepEqual(matchInstructionFile('AGENTS.md'), ['codex']);
    assert.deepEqual(matchInstructionFile('GEMINI.md'), ['gemini']);
});

test('profiles: matchInstructionFile returns empty array for unknown', () => {
    assert.deepEqual(matchInstructionFile('README.md'), []);
});
```

- [ ] **Step 2: Run test and verify failure**

Run: `npm test -- test/profiles.test.js`
Expected: `Cannot find module '../src/profiles'`

- [ ] **Step 3: Implement `src/profiles.js`**

```javascript
const PROFILES = {
    claude: {
        name: 'claude',
        instruction_files: ['CLAUDE.md', '.claude/CLAUDE.md'],
        supports_imports: true,
        skills_dir: '.claude/skills',
        agents_dir: '.claude/agents',
        plugins_manifest: '.claude/settings.json'
    },
    codex: {
        name: 'codex',
        instruction_files: ['AGENTS.md'],
        supports_imports: false,
        skills_dir: '.codex/skills',
        agents_dir: '.codex/agents',
        plugins_manifest: '.codex/config.toml'
    },
    gemini: {
        name: 'gemini',
        instruction_files: ['GEMINI.md'],
        supports_imports: false,
        skills_dir: '.gemini/skills',
        agents_dir: '.gemini/agents',
        plugins_manifest: null
    }
};

function listProfiles() {
    return Object.keys(PROFILES);
}

function getProfile(name) {
    const profile = PROFILES[name];
    if (!profile) {
        throw new Error(`unknown LLM profile: ${name}`);
    }
    return profile;
}

function matchInstructionFile(relativePath) {
    const normalized = relativePath.split('\\').join('/');
    const matches = [];
    for (const [name, profile] of Object.entries(PROFILES)) {
        if (profile.instruction_files.includes(normalized)) {
            matches.push(name);
        }
    }
    return matches;
}

module.exports = { PROFILES, getProfile, listProfiles, matchInstructionFile };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/profiles.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/profiles.js test/profiles.test.js
git commit -m "feat: built-in LLM profiles for claude, codex, gemini"
```

> **Note for implementer:** Exact `supports_imports` values for Codex and Gemini must be verified against current docs before shipping Phase 4. The spec flags this as an open question. Document the source in a comment when you verify.

---

## Task 4: Adapt fs-util.js

**Files:**
- Modify: `src/fs-util.js` (strip unused helpers, add new ones)
- Create: `test/fs-util.test.js`

- [ ] **Step 1: Write failing test**

Create `test/fs-util.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { ensureDir, exists, readUtf8, writeUtf8, writeJson, readJson, kstTimestamp, toPosixRelative } = require('../src/fs-util');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-'));
}

test('fs-util: ensureDir + writeUtf8 + readUtf8 roundtrip', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'nested', 'file.txt');
    writeUtf8(filePath, 'hello');
    assert.equal(exists(filePath), true);
    assert.equal(readUtf8(filePath), 'hello');
});

test('fs-util: writeJson/readJson roundtrip', () => {
    const dir = tmpDir();
    const filePath = path.join(dir, 'a.json');
    writeJson(filePath, { k: 1 });
    assert.deepEqual(readJson(filePath), { k: 1 });
});

test('fs-util: kstTimestamp returns local format', () => {
    const ts = kstTimestamp();
    assert.match(ts, /^\d{4}-\d{2}-\d{2}-\d{6}$/);
});

test('fs-util: toPosixRelative uses forward slashes', () => {
    const rel = toPosixRelative('/root', '/root/sub/file.txt');
    assert.equal(rel, 'sub/file.txt');
});
```

- [ ] **Step 2: Run test, expect failure** (some helpers like `readJson`, `kstTimestamp` don't exist yet)

Run: `npm test -- test/fs-util.test.js`
Expected: fails on missing exports.

- [ ] **Step 3: Rewrite `src/fs-util.js`**

```javascript
const fs = require('node:fs');
const path = require('node:path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function exists(filePath) {
    return fs.existsSync(filePath);
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath) {
    return JSON.parse(readUtf8(filePath));
}

function writeJson(filePath, value) {
    writeUtf8(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function toPosixRelative(fromPath, toPath) {
    return path.relative(fromPath, toPath).split(path.sep).join('/');
}

function kstTimestamp(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${day}-${h}${mi}${s}`;
}

function copyFile(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function removeFile(filePath) {
    if (exists(filePath)) {
        fs.unlinkSync(filePath);
    }
}

function getMtime(filePath) {
    return fs.statSync(filePath).mtimeMs;
}

module.exports = {
    ensureDir,
    exists,
    readUtf8,
    writeUtf8,
    readJson,
    writeJson,
    toPosixRelative,
    kstTimestamp,
    copyFile,
    removeFile,
    getMtime
};
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/fs-util.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fs-util.js test/fs-util.test.js
git commit -m "feat: fs-util with json/mtime/kst helpers"
```

---

## Task 5: Hash module

**Files:**
- Create: `src/hash.js`
- Create: `test/hash.test.js`

- [ ] **Step 1: Write failing test**

Create `test/hash.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashString, hashFile, hashDirectory } = require('../src/hash');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-hash-'));
}

test('hash: hashString is deterministic sha256', () => {
    const h = hashString('hello');
    assert.equal(h, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('hash: hashString normalizes CRLF to LF', () => {
    assert.equal(hashString('a\r\nb'), hashString('a\nb'));
});

test('hash: hashFile reads and hashes', () => {
    const dir = tmpDir();
    const p = path.join(dir, 'x.txt');
    fs.writeFileSync(p, 'hello');
    assert.equal(hashFile(p), hashString('hello'));
});

test('hash: hashDirectory ignores marker file', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B');
    const h1 = hashDirectory(dir);
    fs.writeFileSync(path.join(dir, '.harness-managed'), 'marker');
    const h2 = hashDirectory(dir, { ignore: ['.harness-managed'] });
    assert.equal(h1, h2);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/hash.test.js`
Expected: module not found.

- [ ] **Step 3: Implement `src/hash.js`**

```javascript
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalize(content) {
    return content.split('\r\n').join('\n');
}

function hashString(content) {
    return crypto.createHash('sha256').update(normalize(content)).digest('hex');
}

function hashFile(filePath) {
    return hashString(fs.readFileSync(filePath, 'utf8'));
}

function hashDirectory(dirPath, options) {
    const ignore = new Set((options && options.ignore) || []);
    const entries = [];
    walk(dirPath, '', entries, ignore);
    entries.sort((a, b) => a.rel.localeCompare(b.rel));
    const hasher = crypto.createHash('sha256');
    for (const entry of entries) {
        hasher.update(entry.rel);
        hasher.update('\0');
        hasher.update(entry.hash);
        hasher.update('\0');
    }
    return hasher.digest('hex');
}

function walk(root, rel, out, ignore) {
    const abs = path.join(root, rel);
    const items = fs.readdirSync(abs, { withFileTypes: true });
    for (const item of items) {
        if (ignore.has(item.name)) continue;
        const itemRel = rel ? `${rel}/${item.name}` : item.name;
        if (item.isDirectory()) {
            walk(root, itemRel, out, ignore);
        } else if (item.isFile()) {
            out.push({ rel: itemRel, hash: hashFile(path.join(root, itemRel)) });
        }
    }
}

module.exports = { hashString, hashFile, hashDirectory };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/hash.test.js`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hash.js test/hash.test.js
git commit -m "feat: sha256 hashing for strings, files, and directories"
```

---

## Task 6: Interactive prompt module

**Files:**
- Create: `src/prompt.js`
- Create: `test/prompt.test.js`

- [ ] **Step 1: Write failing test**

Create `test/prompt.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { confirmYesNo, chooseOne } = require('../src/prompt');

test('prompt: confirmYesNo reads Y', async () => {
    const answer = await confirmYesNo('Proceed?', { input: 'Y\n', stdout: new WritableNoop() });
    assert.equal(answer, true);
});

test('prompt: confirmYesNo reads n', async () => {
    const answer = await confirmYesNo('Proceed?', { input: 'n\n', stdout: new WritableNoop() });
    assert.equal(answer, false);
});

test('prompt: chooseOne returns selected index', async () => {
    const answer = await chooseOne('Pick:', ['a', 'b', 'c'], { input: '2\n', stdout: new WritableNoop() });
    assert.equal(answer, 'b');
});

class WritableNoop {
    write() {}
}
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/prompt.test.js`
Expected: module not found.

- [ ] **Step 3: Implement `src/prompt.js`**

```javascript
const readline = require('node:readline');
const { Readable } = require('node:stream');

function makeReader(options) {
    const opts = options || {};
    if (typeof opts.input === 'string') {
        return readline.createInterface({
            input: Readable.from([opts.input]),
            output: opts.stdout || process.stdout,
            terminal: false
        });
    }
    return readline.createInterface({
        input: opts.stdin || process.stdin,
        output: opts.stdout || process.stdout,
        terminal: false
    });
}

function ask(rl, question) {
    return new Promise((resolve) => rl.question(question, resolve));
}

async function confirmYesNo(question, options) {
    const rl = makeReader(options);
    try {
        const answer = await ask(rl, `${question} [y/N] `);
        return /^y(es)?$/i.test(answer.trim());
    } finally {
        rl.close();
    }
}

async function chooseOne(question, choices, options) {
    const rl = makeReader(options);
    try {
        const stdout = (options && options.stdout) || process.stdout;
        stdout.write(`${question}\n`);
        choices.forEach((choice, idx) => stdout.write(`  ${idx + 1}. ${choice}\n`));
        const answer = await ask(rl, 'Choice: ');
        const index = parseInt(answer.trim(), 10) - 1;
        if (index < 0 || index >= choices.length) {
            throw new Error(`invalid choice: ${answer}`);
        }
        return choices[index];
    } finally {
        rl.close();
    }
}

module.exports = { confirmYesNo, chooseOne };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/prompt.test.js`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompt.js test/prompt.test.js
git commit -m "feat: interactive prompt helpers (confirm, chooseOne)"
```

---

## Task 7: State module (.sync-state.json)

**Files:**
- Create: `src/state.js`
- Create: `test/state.test.js`

- [ ] **Step 1: Write failing test**

Create `test/state.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { emptyState, loadState, saveState, getClassification, setClassification } = require('../src/state');

function tmpProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-state-'));
    fs.mkdirSync(path.join(dir, '.harness'));
    return dir;
}

test('state: loadState returns empty when file missing', () => {
    const root = tmpProject();
    const s = loadState(root);
    assert.deepEqual(s, emptyState());
});

test('state: saveState + loadState roundtrip', () => {
    const root = tmpProject();
    const s = emptyState();
    s.assets.instructions.push({ path: 'CLAUDE.md', hash: 'abc' });
    saveState(root, s);
    const loaded = loadState(root);
    assert.deepEqual(loaded.assets.instructions, [{ path: 'CLAUDE.md', hash: 'abc' }]);
});

test('state: classification helpers', () => {
    const s = emptyState();
    setClassification(s, 'AGENTS.md', 'codex');
    assert.equal(getClassification(s, 'AGENTS.md'), 'codex');
    assert.equal(getClassification(s, 'CLAUDE.md'), undefined);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/state.test.js`

- [ ] **Step 3: Implement `src/state.js`**

```javascript
const path = require('node:path');
const { exists, readJson, writeJson, kstTimestamp } = require('./fs-util');

const STATE_FILE = '.harness/.sync-state.json';
const STATE_VERSION = 1;

function stateFilePath(root) {
    return path.join(root, STATE_FILE);
}

function emptyState() {
    return {
        version: STATE_VERSION,
        synced_at: null,
        assets: {
            instructions: [],
            skills: [],
            agents: []
        },
        plugins: [],
        classifications: {}
    };
}

function loadState(root) {
    const p = stateFilePath(root);
    if (!exists(p)) {
        return emptyState();
    }
    const data = readJson(p);
    if (data.version !== STATE_VERSION) {
        throw new Error(`unsupported .sync-state.json version: ${data.version}`);
    }
    return data;
}

function saveState(root, state) {
    const out = { ...state, synced_at: kstIso() };
    writeJson(stateFilePath(root), out);
}

function kstIso() {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return `${kst.toISOString().replace('Z', '+09:00')}`.replace(/\.\d+\+/, '+');
}

function getClassification(state, key) {
    return state.classifications[key];
}

function setClassification(state, key, value) {
    state.classifications[key] = value;
}

module.exports = {
    emptyState,
    loadState,
    saveState,
    stateFilePath,
    getClassification,
    setClassification
};
```

Note: `kstTimestamp` from fs-util is used for backup directory names; `.sync-state.json` uses an ISO-ish KST string (local helper `kstIso`) to match the spec example.

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/state.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/state.js test/state.test.js
git commit -m "feat: .sync-state.json load/save + classification cache"
```

---

## Task 8: Backup module

**Files:**
- Create: `src/backup.js`
- Create: `test/backup.test.js`

- [ ] **Step 1: Write failing test**

Create `test/backup.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createBackup, listBackups, restoreBackup } = require('../src/backup');

function tmpProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-backup-'));
    fs.mkdirSync(path.join(dir, '.harness'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'original content');
    return dir;
}

test('backup: creates timestamped directory with manifest', () => {
    const root = tmpProject();
    const ts = createBackup(root, [path.join(root, 'CLAUDE.md')]);
    const backupDir = path.join(root, '.harness', 'backups', ts);
    assert.equal(fs.existsSync(backupDir), true);
    assert.equal(fs.existsSync(path.join(backupDir, 'manifest.json')), true);
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.files.length, 1);
    assert.equal(manifest.files[0].rel, 'CLAUDE.md');
});

test('backup: listBackups returns timestamps in descending order', () => {
    const root = tmpProject();
    const ts1 = createBackup(root, [path.join(root, 'CLAUDE.md')]);
    // Ensure second timestamp differs
    const delay = new Promise((r) => setTimeout(r, 1100));
    return delay.then(() => {
        const ts2 = createBackup(root, [path.join(root, 'CLAUDE.md')]);
        const list = listBackups(root);
        assert.deepEqual(list, [ts2, ts1]);
    });
});

test('backup: restoreBackup replaces current files', () => {
    const root = tmpProject();
    const ts = createBackup(root, [path.join(root, 'CLAUDE.md')]);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'modified');
    restoreBackup(root, ts);
    assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), 'original content');
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/backup.test.js`

- [ ] **Step 3: Implement `src/backup.js`**

```javascript
const fs = require('node:fs');
const path = require('node:path');
const { ensureDir, exists, writeJson, readJson, copyFile, kstTimestamp, toPosixRelative } = require('./fs-util');

function backupsRoot(projectRoot) {
    return path.join(projectRoot, '.harness', 'backups');
}

function createBackup(projectRoot, filePaths) {
    const ts = kstTimestamp();
    const dir = path.join(backupsRoot(projectRoot), ts);
    ensureDir(dir);

    const manifest = {
        version: 1,
        created_at: ts,
        files: []
    };

    for (const filePath of filePaths) {
        if (!exists(filePath)) continue;
        const rel = toPosixRelative(projectRoot, filePath);
        const target = path.join(dir, 'files', rel);
        copyFile(filePath, target);
        manifest.files.push({ rel, absolute: filePath });
    }

    writeJson(path.join(dir, 'manifest.json'), manifest);
    return ts;
}

function listBackups(projectRoot) {
    const dir = backupsRoot(projectRoot);
    if (!exists(dir)) return [];
    return fs.readdirSync(dir)
        .filter((name) => /^\d{4}-\d{2}-\d{2}-\d{6}$/.test(name))
        .sort()
        .reverse();
}

function restoreBackup(projectRoot, timestamp) {
    const dir = path.join(backupsRoot(projectRoot), timestamp);
    if (!exists(dir)) {
        throw new Error(`backup not found: ${timestamp}`);
    }
    const manifest = readJson(path.join(dir, 'manifest.json'));
    for (const entry of manifest.files) {
        const src = path.join(dir, 'files', entry.rel);
        const dest = path.join(projectRoot, entry.rel);
        copyFile(src, dest);
    }
    return manifest.files.length;
}

module.exports = { createBackup, listBackups, restoreBackup };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/backup.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/backup.js test/backup.test.js
git commit -m "feat: timestamped backups with manifest + restore"
```

---

## Task 9: Discover instruction files

**Files:**
- Create: `src/discover.js`
- Create: `test/discover.test.js`
- Create: `test/fixtures/discover-basic/` (fixture tree)

- [ ] **Step 1: Create fixture**

```bash
mkdir -p test/fixtures/discover-basic/.claude
```

Write `test/fixtures/discover-basic/CLAUDE.md`:
```
# Claude Instructions
Some content here.
```

Write `test/fixtures/discover-basic/AGENTS.md`:
```
# Codex Agents
Codex content.
```

Write `test/fixtures/discover-basic/.claude/CLAUDE.md`:
```
# Nested Claude
Nested content.
```

- [ ] **Step 2: Write failing test**

Create `test/discover.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { discoverInstructions } = require('../src/discover');

const FIXTURE = path.join(__dirname, 'fixtures', 'discover-basic');

test('discover: finds CLAUDE.md and classifies as claude', () => {
    const results = discoverInstructions(FIXTURE);
    const paths = results.map((r) => r.relativePath).sort();
    assert.deepEqual(paths, ['.claude/CLAUDE.md', 'AGENTS.md', 'CLAUDE.md']);

    const byPath = Object.fromEntries(results.map((r) => [r.relativePath, r]));
    assert.deepEqual(byPath['CLAUDE.md'].llmCandidates, ['claude']);
    assert.deepEqual(byPath['AGENTS.md'].llmCandidates, ['codex']);
    assert.deepEqual(byPath['.claude/CLAUDE.md'].llmCandidates, ['claude']);
});

test('discover: missing files produce empty result', () => {
    const dir = path.join(__dirname, 'fixtures');  // no instruction files here
    const results = discoverInstructions(dir);
    assert.deepEqual(results, []);
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `npm test -- test/discover.test.js`

- [ ] **Step 4: Implement `src/discover.js`**

```javascript
const path = require('node:path');
const { exists, readUtf8 } = require('./fs-util');
const { listProfiles, getProfile, matchInstructionFile } = require('./profiles');

function discoverInstructions(projectRoot) {
    const candidatePaths = new Set();
    for (const name of listProfiles()) {
        const profile = getProfile(name);
        for (const file of profile.instruction_files) {
            candidatePaths.add(file);
        }
    }

    const results = [];
    for (const relativePath of candidatePaths) {
        const absolute = path.join(projectRoot, relativePath);
        if (!exists(absolute)) continue;
        results.push({
            relativePath,
            absolutePath: absolute,
            llmCandidates: matchInstructionFile(relativePath),
            content: readUtf8(absolute)
        });
    }
    return results;
}

module.exports = { discoverInstructions };
```

- [ ] **Step 5: Run test and verify pass**

Run: `npm test -- test/discover.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/discover.js test/discover.test.js test/fixtures/discover-basic
git commit -m "feat: discover instruction files and classify via profiles"
```

---

## Task 10: Stub generation

**Files:**
- Create: `src/stubs.js`
- Create: `test/stubs.test.js`

- [ ] **Step 1: Write failing test**

Create `test/stubs.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildImportStub, buildConcatStub } = require('../src/stubs');

test('stubs: buildImportStub for claude', () => {
    const out = buildImportStub({
        llm: 'claude',
        harnessMainPath: '.harness/HARNESS.md',
        llmSpecificPath: '.harness/llm/claude.md'
    });
    assert.match(out, /Managed by soft-harness/);
    assert.match(out, /@\.harness\/HARNESS\.md/);
    assert.match(out, /@\.harness\/llm\/claude\.md/);
});

test('stubs: buildConcatStub wraps content in BEGIN/END markers', () => {
    const out = buildConcatStub({
        llm: 'codex',
        harnessMainContent: 'COMMON',
        llmSpecificContent: 'CODEX-SPECIFIC',
        harnessMainPath: '.harness/HARNESS.md',
        llmSpecificPath: '.harness/llm/codex.md'
    });
    assert.match(out, /<!-- BEGIN HARNESS\.md -->/);
    assert.match(out, /COMMON/);
    assert.match(out, /<!-- END HARNESS\.md -->/);
    assert.match(out, /<!-- BEGIN llm\/codex\.md -->/);
    assert.match(out, /CODEX-SPECIFIC/);
    assert.match(out, /<!-- END llm\/codex\.md -->/);
});

test('stubs: concat stub omits BEGIN/END when content empty', () => {
    const out = buildConcatStub({
        llm: 'codex',
        harnessMainContent: '',
        llmSpecificContent: 'only codex',
        harnessMainPath: '.harness/HARNESS.md',
        llmSpecificPath: '.harness/llm/codex.md'
    });
    assert.doesNotMatch(out, /BEGIN HARNESS\.md/);
    assert.match(out, /BEGIN llm\/codex\.md/);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/stubs.test.js`

- [ ] **Step 3: Implement `src/stubs.js`**

```javascript
function header(llm, harnessMainPath, llmSpecificPath) {
    return [
        '<!-- Managed by soft-harness. Do not edit this file directly. -->',
        `<!-- Source: ${harnessMainPath} + ${llmSpecificPath} -->`,
        '<!-- Regenerate: soft-harness sync -->'
    ].join('\n');
}

function buildImportStub(opts) {
    const { llm, harnessMainPath, llmSpecificPath } = opts;
    void llm;
    const lines = [
        header(llm, harnessMainPath, llmSpecificPath),
        '',
        `@${harnessMainPath}`,
        `@${llmSpecificPath}`,
        ''
    ];
    return lines.join('\n');
}

function buildConcatStub(opts) {
    const { llm, harnessMainContent, llmSpecificContent, harnessMainPath, llmSpecificPath } = opts;
    void llm;
    const parts = [header(llm, harnessMainPath, llmSpecificPath)];

    if (harnessMainContent && harnessMainContent.length > 0) {
        parts.push('<!-- BEGIN HARNESS.md -->');
        parts.push('');
        parts.push(harnessMainContent.replace(/\s+$/, ''));
        parts.push('');
        parts.push('<!-- END HARNESS.md -->');
    }

    if (llmSpecificContent && llmSpecificContent.length > 0) {
        const label = llmSpecificPath.startsWith('.harness/')
            ? llmSpecificPath.slice('.harness/'.length)
            : llmSpecificPath;
        parts.push(`<!-- BEGIN ${label} -->`);
        parts.push('');
        parts.push(llmSpecificContent.replace(/\s+$/, ''));
        parts.push('');
        parts.push(`<!-- END ${label} -->`);
    }

    return parts.join('\n') + '\n';
}

module.exports = { buildImportStub, buildConcatStub };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/stubs.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/stubs.js test/stubs.test.js
git commit -m "feat: import-stub and concat-stub generation"
```

---

## Task 11: Import direction (wholesale move)

**Files:**
- Create: `src/import.js`
- Create: `test/import.test.js`
- Create: `test/fixtures/import-fresh/` (fixture)

- [ ] **Step 1: Create fixture**

```bash
mkdir -p test/fixtures/import-fresh
```

Write `test/fixtures/import-fresh/CLAUDE.md`:
```
# Claude
hello claude
```

Write `test/fixtures/import-fresh/AGENTS.md`:
```
# Agents
hello codex
```

- [ ] **Step 2: Write failing test**

Create `test/import.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { importInstructions } = require('../src/import');

function copyFixture(name) {
    const src = path.join(__dirname, 'fixtures', name);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), `sh-imp-${name}-`));
    copyDir(src, dest);
    return dest;
}

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

test('import: wholesale moves CLAUDE.md and AGENTS.md into .harness/llm/', () => {
    const root = copyFixture('import-fresh');
    const result = importInstructions(root, {
        classifyAmbiguous: () => { throw new Error('no ambiguous in this fixture'); }
    });

    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'codex.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'HARNESS.md')), true);
    assert.equal(fs.readFileSync(path.join(root, '.harness', 'HARNESS.md'), 'utf8'), '');
    assert.match(fs.readFileSync(path.join(root, '.harness', 'llm', 'claude.md'), 'utf8'), /hello claude/);
    assert.match(fs.readFileSync(path.join(root, '.harness', 'llm', 'codex.md'), 'utf8'), /hello codex/);
    assert.equal(result.moved.length, 2);
});

test('import: creates .harness/.gitignore on first run', () => {
    const root = copyFixture('import-fresh');
    importInstructions(root, { classifyAmbiguous: () => { throw new Error('n/a'); } });
    const gi = fs.readFileSync(path.join(root, '.harness', '.gitignore'), 'utf8');
    assert.match(gi, /\.sync-state\.json/);
    assert.match(gi, /backups\//);
});
```

- [ ] **Step 3: Run test, expect failure**

Run: `npm test -- test/import.test.js`

- [ ] **Step 4: Implement `src/import.js`**

```javascript
const path = require('node:path');
const { ensureDir, exists, writeUtf8 } = require('./fs-util');
const { discoverInstructions } = require('./discover');

const GITIGNORE_CONTENT = `.sync-state.json\nbackups/\n`;

async function importInstructions(projectRoot, options) {
    const classifyAmbiguous = options.classifyAmbiguous;
    const discovered = discoverInstructions(projectRoot);

    ensureDir(path.join(projectRoot, '.harness', 'llm'));

    const gitignorePath = path.join(projectRoot, '.harness', '.gitignore');
    if (!exists(gitignorePath)) {
        writeUtf8(gitignorePath, GITIGNORE_CONTENT);
    }

    const harnessMain = path.join(projectRoot, '.harness', 'HARNESS.md');
    if (!exists(harnessMain)) {
        writeUtf8(harnessMain, '');
    }

    const moved = [];
    for (const item of discovered) {
        let llm;
        if (item.llmCandidates.length === 1) {
            llm = item.llmCandidates[0];
        } else if (item.llmCandidates.length === 0) {
            continue;
        } else {
            llm = await classifyAmbiguous(item);
        }

        const target = path.join(projectRoot, '.harness', 'llm', `${llm}.md`);
        writeUtf8(target, item.content);
        moved.push({
            from: item.relativePath,
            to: path.posix.join('.harness', 'llm', `${llm}.md`),
            llm
        });
    }

    return { moved };
}

module.exports = { importInstructions };
```

- [ ] **Step 5: Run test and verify pass**

Run: `npm test -- test/import.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/import.js test/import.test.js test/fixtures/import-fresh
git commit -m "feat: wholesale instruction file import to .harness/llm/"
```

---

## Task 12: Export direction (write stubs to root)

**Files:**
- Create: `src/export.js`
- Create: `test/export.test.js`

- [ ] **Step 1: Write failing test**

Create `test/export.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { exportInstructions } = require('../src/export');

function makeHarnessProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-exp-'));
    fs.mkdirSync(path.join(root, '.harness', 'llm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness', 'HARNESS.md'), '');
    fs.writeFileSync(path.join(root, '.harness', 'llm', 'claude.md'), '# Claude\nhello');
    fs.writeFileSync(path.join(root, '.harness', 'llm', 'codex.md'), '# Codex\nhi');
    return root;
}

test('export: writes import-stub for claude', () => {
    const root = makeHarnessProject();
    const result = exportInstructions(root);
    const claudeStub = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claudeStub, /@\.harness\/HARNESS\.md/);
    assert.match(claudeStub, /@\.harness\/llm\/claude\.md/);
    assert.ok(result.written.includes('CLAUDE.md'));
});

test('export: writes concat-stub for codex', () => {
    const root = makeHarnessProject();
    exportInstructions(root);
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /<!-- BEGIN llm\/codex\.md -->/);
    assert.match(agents, /# Codex/);
});

test('export: skips files with no content', () => {
    const root = makeHarnessProject();
    // Remove gemini input — no llm/gemini.md means no GEMINI.md output
    const result = exportInstructions(root);
    assert.equal(fs.existsSync(path.join(root, 'GEMINI.md')), false);
    assert.equal(result.skipped.some((s) => s.llm === 'gemini'), true);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/export.test.js`

- [ ] **Step 3: Implement `src/export.js`**

```javascript
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');
const { listProfiles, getProfile } = require('./profiles');
const { buildImportStub, buildConcatStub } = require('./stubs');

const HARNESS_MAIN_REL = '.harness/HARNESS.md';

function exportInstructions(projectRoot) {
    const written = [];
    const skipped = [];

    const harnessMainAbs = path.join(projectRoot, '.harness', 'HARNESS.md');
    const harnessMainContent = exists(harnessMainAbs) ? readUtf8(harnessMainAbs) : '';

    for (const llm of listProfiles()) {
        const profile = getProfile(llm);
        const llmSpecificRel = `.harness/llm/${llm}.md`;
        const llmSpecificAbs = path.join(projectRoot, '.harness', 'llm', `${llm}.md`);
        if (!exists(llmSpecificAbs)) {
            skipped.push({ llm, reason: 'no llm file' });
            continue;
        }

        const llmSpecificContent = readUtf8(llmSpecificAbs);
        if (llmSpecificContent.trim() === '' && harnessMainContent.trim() === '') {
            skipped.push({ llm, reason: 'empty sources' });
            continue;
        }

        const stubContent = profile.supports_imports
            ? buildImportStub({
                llm,
                harnessMainPath: HARNESS_MAIN_REL,
                llmSpecificPath: llmSpecificRel
            })
            : buildConcatStub({
                llm,
                harnessMainContent,
                llmSpecificContent,
                harnessMainPath: HARNESS_MAIN_REL,
                llmSpecificPath: llmSpecificRel
            });

        for (const instrFile of profile.instruction_files) {
            const target = path.join(projectRoot, instrFile);
            writeUtf8(target, stubContent);
            written.push(instrFile);
        }
    }

    return { written, skipped };
}

module.exports = { exportInstructions };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/export.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/export.js test/export.test.js
git commit -m "feat: export instructions as stubs to root"
```

---

## Task 13: Drift detection (instructions)

**Files:**
- Create: `src/drift.js`
- Create: `test/drift.test.js`

- [ ] **Step 1: Write failing test**

Create `test/drift.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { detectInstructionDrift } = require('../src/drift');
const { exportInstructions } = require('../src/export');

function makeProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-drift-'));
    fs.mkdirSync(path.join(root, '.harness', 'llm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.harness', 'HARNESS.md'), '');
    fs.writeFileSync(path.join(root, '.harness', 'llm', 'claude.md'), 'C');
    fs.writeFileSync(path.join(root, '.harness', 'llm', 'codex.md'), 'X');
    exportInstructions(root);
    return root;
}

test('drift: reports none after fresh export', () => {
    const root = makeProject();
    const result = detectInstructionDrift(root);
    assert.deepEqual(result, []);
});

test('drift: detects edited CLAUDE.md', () => {
    const root = makeProject();
    fs.appendFileSync(path.join(root, 'CLAUDE.md'), '\nrogue edit\n');
    const result = detectInstructionDrift(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].file, 'CLAUDE.md');
    assert.equal(result[0].kind, 'modified');
});

test('drift: detects edited AGENTS.md (concat stub)', () => {
    const root = makeProject();
    const agents = path.join(root, 'AGENTS.md');
    const content = fs.readFileSync(agents, 'utf8');
    fs.writeFileSync(agents, content.replace('X', 'X-EDIT'));
    const result = detectInstructionDrift(root);
    assert.equal(result.length, 1);
    assert.equal(result[0].file, 'AGENTS.md');
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/drift.test.js`

- [ ] **Step 3: Implement `src/drift.js`**

```javascript
const path = require('node:path');
const { exists, readUtf8 } = require('./fs-util');
const { listProfiles, getProfile } = require('./profiles');
const { buildImportStub, buildConcatStub } = require('./stubs');

const HARNESS_MAIN_REL = '.harness/HARNESS.md';

function detectInstructionDrift(projectRoot) {
    const drifts = [];

    const harnessMainAbs = path.join(projectRoot, '.harness', 'HARNESS.md');
    const harnessMainContent = exists(harnessMainAbs) ? readUtf8(harnessMainAbs) : '';

    for (const llm of listProfiles()) {
        const profile = getProfile(llm);
        const llmSpecificRel = `.harness/llm/${llm}.md`;
        const llmSpecificAbs = path.join(projectRoot, '.harness', 'llm', `${llm}.md`);
        if (!exists(llmSpecificAbs)) continue;
        const llmSpecificContent = readUtf8(llmSpecificAbs);

        const expected = profile.supports_imports
            ? buildImportStub({
                llm,
                harnessMainPath: HARNESS_MAIN_REL,
                llmSpecificPath: llmSpecificRel
            })
            : buildConcatStub({
                llm,
                harnessMainContent,
                llmSpecificContent,
                harnessMainPath: HARNESS_MAIN_REL,
                llmSpecificPath: llmSpecificRel
            });

        for (const instrFile of profile.instruction_files) {
            const target = path.join(projectRoot, instrFile);
            if (!exists(target)) {
                drifts.push({ file: instrFile, kind: 'missing', llm });
                continue;
            }
            const actual = readUtf8(target);
            if (actual !== expected) {
                drifts.push({ file: instrFile, kind: 'modified', llm });
            }
        }
    }

    return drifts;
}

module.exports = { detectInstructionDrift };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/drift.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/drift.js test/drift.test.js
git commit -m "feat: instruction drift detection via expected stub diff"
```

---

## Task 14: Sync orchestrator

**Files:**
- Create: `src/sync.js`
- Create: `test/sync.test.js`

- [ ] **Step 1: Write failing test**

Create `test/sync.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runSync } = require('../src/sync');

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function copyFixture(name) {
    const src = path.join(__dirname, 'fixtures', name);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), `sh-sync-${name}-`));
    copyDir(src, dest);
    return dest;
}

test('sync: first-run imports then exports (fresh project)', async () => {
    const root = copyFixture('import-fresh');
    const result = await runSync(root, { classifyAmbiguous: async () => { throw new Error('n/a'); } });

    // Imported
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'codex.md')), true);

    // Exported — root CLAUDE.md is now a stub
    const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /Managed by soft-harness/);
    assert.match(claude, /@\.harness\/llm\/claude\.md/);

    assert.equal(result.phase, 'completed');
});

test('sync: dry-run reports without writing', async () => {
    const root = copyFixture('import-fresh');
    const result = await runSync(root, { dryRun: true, classifyAmbiguous: async () => { throw new Error('n/a'); } });

    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), false);
    assert.equal(result.phase, 'dry-run');
    assert.ok(result.plan.import.length > 0);
});

test('sync: --no-import skips import phase', async () => {
    const root = copyFixture('import-fresh');
    await runSync(root, { noImport: true, classifyAmbiguous: async () => { throw new Error('n/a'); } });
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), false);
});

test('sync: --no-export skips export phase', async () => {
    const root = copyFixture('import-fresh');
    // Remove existing CLAUDE.md at root first so we can tell it wasn't regenerated
    fs.unlinkSync(path.join(root, 'CLAUDE.md'));
    await runSync(root, { noExport: true, classifyAmbiguous: async () => { throw new Error('n/a'); } });
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'codex.md')), true);
    assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), false);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/sync.test.js`

- [ ] **Step 3: Implement `src/sync.js`**

```javascript
const path = require('node:path');
const { ensureDir, exists } = require('./fs-util');
const { discoverInstructions } = require('./discover');
const { importInstructions } = require('./import');
const { exportInstructions } = require('./export');
const { detectInstructionDrift } = require('./drift');
const { createBackup } = require('./backup');
const { loadState, saveState } = require('./state');

async function runSync(projectRoot, options) {
    const opts = options || {};
    const dryRun = Boolean(opts.dryRun);
    const noImport = Boolean(opts.noImport);
    const noExport = Boolean(opts.noExport);
    const classifyAmbiguous = opts.classifyAmbiguous || (async () => {
        throw new Error('classifyAmbiguous not provided and ambiguous file encountered');
    });

    ensureDir(path.join(projectRoot, '.harness'));
    const state = loadState(projectRoot);

    const plan = { import: [], export: [], drift: [] };

    // Plan import
    const discovered = discoverInstructions(projectRoot);
    for (const item of discovered) {
        plan.import.push({ from: item.relativePath, candidates: item.llmCandidates });
    }

    // Plan drift (only if .harness already has content)
    plan.drift = detectInstructionDrift(projectRoot);

    if (dryRun) {
        return { phase: 'dry-run', plan };
    }

    // Backup touched files before writes
    const toBackup = [];
    for (const item of discovered) toBackup.push(item.absolutePath);
    for (const d of plan.drift) toBackup.push(path.join(projectRoot, d.file));
    let backupTs = null;
    if (toBackup.length > 0) {
        backupTs = createBackup(projectRoot, Array.from(new Set(toBackup)));
    }

    // Import phase
    let importResult = { moved: [] };
    if (!noImport) {
        importResult = await importInstructions(projectRoot, { classifyAmbiguous });
        for (const move of importResult.moved) {
            state.assets.instructions = state.assets.instructions.filter((a) => a.path !== move.from);
            state.assets.instructions.push({ path: move.to, llm: move.llm });
        }
    }

    // Export phase
    let exportResult = { written: [], skipped: [] };
    if (!noExport) {
        exportResult = exportInstructions(projectRoot);
    }

    saveState(projectRoot, state);

    return {
        phase: 'completed',
        backupTs,
        imported: importResult.moved,
        exported: exportResult.written,
        plan
    };
}

module.exports = { runSync };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/sync.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/sync.js test/sync.test.js
git commit -m "feat: sync orchestrator with dry-run and direction flags"
```

---

## Task 15: Revert command

**Files:**
- Create: `src/revert.js`
- Create: `test/revert.test.js`

- [ ] **Step 1: Write failing test**

Create `test/revert.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runRevert } = require('../src/revert');
const { createBackup } = require('../src/backup');

function tmpProject() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-revert-'));
    fs.mkdirSync(path.join(root, '.harness'));
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'original');
    return root;
}

test('revert: --list shows available backups', () => {
    const root = tmpProject();
    createBackup(root, [path.join(root, 'CLAUDE.md')]);
    const output = [];
    runRevert(root, { list: true, log: (msg) => output.push(msg) });
    assert.ok(output.join('\n').match(/\d{4}-\d{2}-\d{2}-\d{6}/));
});

test('revert: restores named backup', () => {
    const root = tmpProject();
    const ts = createBackup(root, [path.join(root, 'CLAUDE.md')]);
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'modified');
    runRevert(root, { timestamp: ts, log: () => {} });
    assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), 'original');
});

test('revert: throws for unknown timestamp', () => {
    const root = tmpProject();
    assert.throws(() => runRevert(root, { timestamp: '1999-01-01-000000', log: () => {} }), /not found/);
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `npm test -- test/revert.test.js`

- [ ] **Step 3: Implement `src/revert.js`**

```javascript
const { listBackups, restoreBackup } = require('./backup');

function runRevert(projectRoot, options) {
    const opts = options || {};
    const log = opts.log || ((msg) => process.stdout.write(`${msg}\n`));

    if (opts.list) {
        const backups = listBackups(projectRoot);
        if (backups.length === 0) {
            log('No backups found.');
            return;
        }
        log('Available backups (newest first):');
        for (const ts of backups) log(`  ${ts}`);
        return;
    }

    if (!opts.timestamp) {
        throw new Error('revert requires either --list or a timestamp');
    }

    const count = restoreBackup(projectRoot, opts.timestamp);
    log(`✓ Restored ${count} file(s) from backup ${opts.timestamp}`);
}

module.exports = { runRevert };
```

- [ ] **Step 4: Run test and verify pass**

Run: `npm test -- test/revert.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/revert.js test/revert.test.js
git commit -m "feat: revert command with list and restore"
```

---

## Task 16: Wire CLI to sync and revert

**Files:**
- Modify: `src/cli.js`
- Modify: `test/cli.test.js`

- [ ] **Step 1: Update failing test for wired sync**

Append to `test/cli.test.js`:

```javascript
const fs = require('node:fs');
const os = require('node:os');

function tmpFresh() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-cli-'));
    fs.writeFileSync(path.join(dir, 'CLAUDE.md'), '# Claude\nhi');
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Codex\nhey');
    return dir;
}

test('cli: sync --dry-run reports plan', () => {
    const root = tmpFresh();
    const result = spawnSync('node', [CLI, 'sync', '--dry-run'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /dry-run/);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), false);
});

test('cli: sync writes .harness and stubs', () => {
    const root = tmpFresh();
    const result = spawnSync('node', [CLI, 'sync'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), true);
    assert.match(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), /Managed by soft-harness/);
});

test('cli: revert --list runs', () => {
    const root = tmpFresh();
    spawnSync('node', [CLI, 'sync'], { cwd: root, encoding: 'utf8' });
    const result = spawnSync('node', [CLI, 'revert', '--list'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /\d{4}-\d{2}-\d{2}-\d{6}|No backups/);
});
```

- [ ] **Step 2: Run tests, expect new ones to fail**

Run: `npm test -- test/cli.test.js`

- [ ] **Step 3: Update `src/cli.js` runSync and runRevert**

Replace the two stub functions in `src/cli.js`:

```javascript
function runSync(args) {
    const options = parseSyncArgs(args);
    const { runSync: runSyncImpl } = require('./sync');

    return runSyncImpl(process.cwd(), {
        dryRun: options.dryRun,
        noImport: options.noImport,
        noExport: options.noExport,
        manualReview: options.manualReview,
        noRunInstalls: options.noRunInstalls,
        noRunUninstalls: options.noRunUninstalls,
        classifyAmbiguous: async (item) => {
            const { chooseOne } = require('./prompt');
            return chooseOne(
                `Classify ${item.relativePath}:`,
                item.llmCandidates
            );
        }
    }).then((result) => {
        if (result.phase === 'dry-run') {
            process.stdout.write(`dry-run: ${result.plan.import.length} import candidates, ${result.plan.drift.length} drift entries\n`);
        } else {
            process.stdout.write(`✓ sync completed. imported=${result.imported.length}, exported=${result.exported.length}\n`);
            if (result.backupTs) process.stdout.write(`  backup: ${result.backupTs}\n`);
        }
        return 0;
    }).catch((err) => {
        process.stderr.write(`❌ sync failed: ${err.message}\n`);
        return 1;
    });
}

function runRevert(args) {
    const { runRevert: runRevertImpl } = require('./revert');
    if (args.includes('--list')) {
        runRevertImpl(process.cwd(), { list: true });
        return 0;
    }
    const timestamp = args.find((a) => !a.startsWith('--'));
    if (!timestamp) {
        process.stderr.write('revert requires --list or a timestamp\n');
        return 1;
    }
    try {
        runRevertImpl(process.cwd(), { timestamp });
        return 0;
    } catch (err) {
        process.stderr.write(`❌ revert failed: ${err.message}\n`);
        return 1;
    }
}

function parseSyncArgs(args) {
    const flags = new Set(args);
    return {
        dryRun: flags.has('--dry-run') || flags.has('-n'),
        manualReview: flags.has('--manual-review') || flags.has('-i'),
        noImport: flags.has('--no-import'),
        noExport: flags.has('--no-export'),
        noRunInstalls: flags.has('--no-run-installs'),
        noRunUninstalls: flags.has('--no-run-uninstalls')
    };
}
```

And update `main()` to await sync (it returns a promise):

```javascript
async function main(argv) {
    const command = argv[2] || 'help';

    switch (command) {
        case 'help':
        case '--help':
        case '-h':
            process.stdout.write(HELP);
            return 0;
        case 'sync':
            return runSync(argv.slice(3));
        case 'revert':
            return runRevert(argv.slice(3));
        default:
            process.stderr.write(`unknown command: ${command}\n${HELP}`);
            return 1;
    }
}

if (require.main === module) {
    main(process.argv).then((code) => process.exit(code));
}
```

- [ ] **Step 4: Run tests, verify all pass**

Run: `npm test`
Expected: all test files pass.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js test/cli.test.js
git commit -m "feat: wire cli to sync and revert with flag parsing"
```

---

## Task 17: Phase 1 end-to-end fixture test

**Files:**
- Create: `test/e2e-phase1.test.js`
- Create: `test/fixtures/e2e-mixed/` (realistic mixed project)

- [ ] **Step 1: Create fixture**

```bash
mkdir -p test/fixtures/e2e-mixed/.claude
```

Write `test/fixtures/e2e-mixed/CLAUDE.md`:
```
# Project

## Code Style
- 4-space indentation
- single quotes

## Claude-specific
Use MCP servers from `.mcp.json`.
```

Write `test/fixtures/e2e-mixed/AGENTS.md`:
```
# Project

## Code Style
- 4-space indentation
- single quotes

## Codex-specific
Run build with `npm run build`.
```

- [ ] **Step 2: Write E2E test**

Create `test/e2e-phase1.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runSync } = require('../src/sync');
const { listBackups, restoreBackup } = require('../src/backup');

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(s, d);
        else fs.copyFileSync(s, d);
    }
}

function copyFixture(name) {
    const src = path.join(__dirname, 'fixtures', name);
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), `sh-e2e-${name}-`));
    copyDir(src, dest);
    return dest;
}

test('e2e: full sync cycle on mixed project', async () => {
    const root = copyFixture('e2e-mixed');

    // Initial sync: adopt
    const r1 = await runSync(root, {
        classifyAmbiguous: async () => { throw new Error('none expected'); }
    });
    assert.equal(r1.phase, 'completed');
    assert.equal(r1.imported.length, 2);

    // .harness/ structure exists
    assert.equal(fs.existsSync(path.join(root, '.harness', 'HARNESS.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'claude.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'llm', 'codex.md')), true);
    assert.equal(fs.existsSync(path.join(root, '.harness', '.gitignore')), true);

    // Root files are now stubs
    const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
    assert.match(claude, /Managed by soft-harness/);

    // Second sync: near no-op (no changes)
    const r2 = await runSync(root, { classifyAmbiguous: async () => { throw new Error('none'); } });
    assert.equal(r2.phase, 'completed');

    // Manual edit to CLAUDE.md creates drift
    fs.appendFileSync(path.join(root, 'CLAUDE.md'), '\n<!-- manual edit -->\n');
    const r3 = await runSync(root, { dryRun: true, classifyAmbiguous: async () => { throw new Error('none'); } });
    assert.ok(r3.plan.drift.length > 0);

    // Revert to first backup
    const backups = listBackups(root);
    assert.ok(backups.length >= 1);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: all tests pass including the e2e.

- [ ] **Step 4: Commit**

```bash
git add test/e2e-phase1.test.js test/fixtures/e2e-mixed
git commit -m "test: phase 1 e2e sync cycle on mixed project"
```

---

## Phase 1 Done — Checkpoint

After Task 17:
- `soft-harness sync` end-to-end for instructions works
- Tests: 15+ files covering every module
- `git log` shows atomic commits per task
- User can try it on any project with root instruction files

**Ship as v0.3.0-alpha** (optional). Bump `package.json` version and tag.

---

# PHASE 2 — Common Extraction + Pull-back + Manual Review

**Goal:** Promote Phase 1 from wholesale-move to intelligent split. Add drift pull-back so edited root files can be pulled back into the correct `.harness/` source. Add `--manual-review` mode for interactive confirmation.

**Shippable after Phase 2:** v0.3.0-beta. `sync` now actually *splits* CLAUDE.md and AGENTS.md, `HARNESS.md` gets the common sections, and drift can be automatically healed.

## Task 18: Markdown section parser (`src/md-parse.js`)

**Files:** `src/md-parse.js`, `test/md-parse.test.js`

**Purpose:** Parse markdown into `{heading, level, body, raw}` sections. Section = everything under a heading until the next heading of equal or lesser level.

**Key test cases:**
- Empty file → one section with empty body
- No headings → one section with entire content as body
- `##` heading followed by `###` subsections → parent section includes subsections in its `body`
- Heading normalization: `## Code Style` and `##  Code Style ` should parse to the same heading text

## Task 19: Content extraction heuristic (`src/extract.js`)

**Files:** `src/extract.js`, `test/extract.test.js`

**Purpose:** Given N instruction files (parsed to sections), compute which sections are common (identical body hash in 2+ files), specific (unique to one file), and maybe-common (fuzzy match, e.g., Levenshtein similarity >0.8).

**Algorithm (from spec § Common-Content Extraction):**
1. For each file, hash each section body
2. Group sections by hash
3. Groups with 2+ members → `common`
4. Groups with 1 member → `llm-specific`
5. For `llm-specific` sections, run pairwise similarity — any pair above threshold goes to `maybe`

**Key test cases:**
- Two files with identical "## Code Style" section → marked common
- Two files with 90%-similar section → marked `maybe`, not auto-promoted
- Single file → no sections marked common (the single-file rule from spec)
- File with no headings → falls back to whole-file-in-single-bucket

## Task 20: Integrate extraction into import (`src/import.js` update)

**Files:** `src/import.js`, `test/import.test.js` (add cases)

**Purpose:** Replace wholesale move with extraction-aware move. Auto-apply `common` candidates to `HARNESS.md`; leave `maybe` in LLM-specific files unless `--manual-review`.

**Key test cases:**
- Two files with shared "Code Style" section → `HARNESS.md` receives it, both `llm/*.md` have only their unique parts
- Single file → still moves wholesale (no common)
- Backward compat: Phase 1 wholesale test still passes

## Task 21: Manual-review mode (`src/prompt.js` extensions)

**Files:** `src/prompt.js`, `src/import.js`, `src/drift.js`, `test/*.test.js` updates

**Purpose:** When `manualReview: true`, each proposed move/extract/drift-resolution prompts the user with a clear diff and Y/N/skip.

**Key test cases:**
- Injected input "n" → change is skipped
- Injected input "y" → change is applied
- Works for import decisions AND drift pull-back decisions

## Task 22: Drift pull-back for import-stubs (`src/pullback.js`)

**Files:** `src/pullback.js`, `test/pullback.test.js`

**Purpose:** When a CLAUDE.md stub has been edited (additional content added), parse the additions and route them back to `.harness/llm/claude.md` (default) or `.harness/HARNESS.md` (with `--manual-review`).

**Key test cases:**
- User appended `## New Section` to CLAUDE.md → auto-appends to `llm/claude.md`
- User replaced the entire file with free text → `llm/claude.md` receives the delta
- With `--manual-review`, user is asked per-section

## Task 23: Drift pull-back for concat-stubs

**Files:** `src/pullback.js` (extend), `test/pullback.test.js` (add cases)

**Purpose:** For concat-stub drift, identify which `BEGIN/END` block an edit fell into, and route the edit back to the matching `.harness/` source file. Edits outside any block go to the LLM-specific file.

**Key test cases:**
- Edit inside `<!-- BEGIN HARNESS.md -->` block → change propagates to `.harness/HARNESS.md`
- Edit inside `<!-- BEGIN llm/codex.md -->` block → propagates to `llm/codex.md`
- Edit outside all blocks → goes to `llm/codex.md` by default

## Task 24: Conflict detection via sync state

**Files:** `src/sync.js` (update), `test/sync.test.js` (add cases)

**Purpose:** When both sides were modified since the last recorded sync, surface a conflict prompt instead of silently letting mtime win.

**Key test cases:**
- Both `.harness/llm/claude.md` AND root `CLAUDE.md` modified since last state snapshot → prompt (or report in dry-run)
- Only one side modified → normal flow

---

# PHASE 3 — Skills & Agents

**Goal:** Extend sync to cover directories under `.claude/skills/`, `.claude/agents/`, and their Codex/Gemini equivalents. Repo-internal exports default to copy+marker; link modes stay explicit and advanced.

**Shippable after Phase 3:** v0.3.0-rc. `sync` now handles all three asset types except plugins.

## Task 25: Platform symlink abstraction (`src/symlink.js`)

**Files:** `src/symlink.js`, `test/symlink.test.js`

**Purpose:** Wrap `fs.symlinkSync` with platform-aware behavior:
- POSIX: try `symlink(2)` when link mode is explicitly requested
- Windows: try directory/file symlink when requested; junction only for explicit compatibility mode
- Any platform: on failure, return `{ mode: 'copy' }` so caller can fall back

**Key test cases:**
- Symlink creation in tmpdir (skip test on platforms where symlinks are disabled)
- `readLink` and `isSymlink` utility functions

## Task 26: Skills/agents discovery (`src/skills.js`)

**Files:** `src/skills.js`, `test/skills.test.js`

**Purpose:** Walk `profile.skills_dir` and `profile.agents_dir` for each profile. Return list of `{name, type, llm, absolutePath, isSymlink}` entries.

**Key test cases:**
- Finds skills under `.claude/skills/*/SKILL.md`
- Finds agents under `.claude/agents/*.md`
- Deduplicates across profiles when content hashes match → marks as "common candidate"

## Task 27: Skills/agents import (bucket assignment)

**Files:** `src/skills.js` (extend), `test/skills.test.js`

**Purpose:** Classify each discovered skill into `.harness/skills/{common,claude,codex,gemini}/<name>/`. Apply the "exactly one bucket" rule: skills that match across LLMs go to `common/`; unique ones go to their LLM bucket.

**Key test cases:**
- Same skill in `.claude/skills/foo` and `.codex/skills/foo` with identical content → `.harness/skills/common/foo/`
- Skill only in `.claude/skills/bar` → `.harness/skills/claude/bar/`
- Differing content across LLMs → prompt user: merge or keep separate

## Task 28: Skills/agents export (symlink or copy+marker)

**Files:** `src/skills.js` (extend), `test/skills.test.js`

**Purpose:** For each `.harness/skills/*/<name>/`, create/update the external target.
- Default: copy directory + write `.harness-managed` marker
- Explicit opt-in: try the requested link mode
- On link failure or Git-safety downgrade: use copy+marker

**Key test cases:**
- Copy+marker path is the repo-internal default
- Explicit link mode downgrades to copy when the target path is not Git-ignored
- Existing symlink with wrong target → replace or normalize back to copy, depending on the desired mode

## Task 29: Skills/agents drift detection + pull-back

**Files:** `src/drift.js` (extend), `src/pullback.js` (extend)

**Purpose:** Detect when symlink broke or copy-mode content hash changed. Pull-back: propagate project-side edits back to `.harness/`.

**Key test cases:**
- Broken symlink → drift
- Copy-mode edit detected by hash comparison
- Pull-back of a single edited file inside a copy-mode skill directory

---

# PHASE 4 — Plugins

**Goal:** `plugins.yaml` parsing, install/uninstall execution, drift detection against each LLM's plugin manifest.

**Shippable after Phase 4:** v0.3.0. Complete feature set.

## Task 30: Plugins module (`src/plugins.js`)

**Files:** `src/plugins.js`, `test/plugins.test.js`

**Purpose:** Parse `.harness/plugins.yaml`, validate schema, expose entries as `{name, llms, source, version, install, uninstall}`.

**Key test cases:**
- Valid YAML parses
- Missing `install` or `uninstall` field → validation error
- `llms` must be an array of known profile names

## Task 31: Install command execution

**Files:** `src/plugins.js` (extend), `test/plugins.test.js`

**Purpose:** Execute `install` commands via `child_process.spawnSync`. Capture exit code, stdout, stderr. Update `.sync-state.json` plugin entries on success.

**Key test cases:**
- Mock install command (`echo ok` on POSIX, `cmd /c echo ok` on Windows) → success
- Mock failing command → error surfaced, state NOT updated
- `--no-run-installs` → commands printed but not run

## Task 32: Uninstall command execution

**Files:** `src/plugins.js` (extend), `test/plugins.test.js`

**Purpose:** When a plugin entry was in the previous state snapshot but not in current `plugins.yaml`, run its `uninstall` command.

**Key test cases:**
- Entry removed from plugins.yaml → uninstall runs
- `--no-run-uninstalls` → uninstall skipped, reported as pending
- Uninstall failure → error surfaced, state NOT updated

## Task 33: Plugin drift detection

**Files:** `src/drift.js` (extend), `test/drift.test.js`

**Purpose:** During import, read each LLM's plugin manifest (e.g., `.claude/settings.json`) and compare against `plugins.yaml`. Unknown installed plugins surface as "adopt into plugins.yaml?" prompts.

**Key test cases:**
- Plugin installed but not in plugins.yaml → candidate for import
- Plugin in plugins.yaml but not installed → target for install on next sync
- Manual override: user declines adoption, decision cached in state

## Task 34: Sync integration for plugins

**Files:** `src/sync.js` (extend), `test/sync.test.js`

**Purpose:** Add plugin phase to `sync` orchestrator. Respects `--no-run-installs` and `--no-run-uninstalls`. Plugin state changes are recorded in `.sync-state.json`.

**Key test cases:**
- New plugin added to plugins.yaml → sync installs it
- Plugin removed → sync uninstalls it
- Flags honored

---

# PHASE 5 — Dogfood + Ship

**Goal:** Use soft-harness on itself. Delete legacy `harness/` tree. Update README. Publish v0.3.0.

## Task 35: Run sync on soft-harness repo

**Files:** new `.harness/` tree in soft-harness root

**Steps:**
1. Run `node src/cli.js sync --dry-run` from soft-harness root
2. Review proposed plan
3. Run `node src/cli.js sync` for real
4. Verify: `.harness/HARNESS.md` contains common content from old AGENTS.md; `.harness/llm/codex.md` has Codex-specific parts
5. Verify: root `AGENTS.md` is now a concat-stub
6. Commit: `chore: adopt .harness/ structure (dogfood)`

## Task 36: Delete legacy `harness/` directory

(Already deleted in Task 1 during clean break. This is a verification step.)

**Steps:**
1. `ls harness/ 2>&1` — confirm not present
2. Check `package.json` `files:` array — remove any remaining `harness/` references
3. Commit if changes

## Task 37: Update README

**Files:** `README.md`

**Steps:**
1. Rewrite installation and quick-start sections around `sync` + `revert` (delete the `init/discover/migrate/generate/apply/doctor/approve` section — those commands no longer exist)
2. Update layout diagram to show `.harness/`
3. Update Commands section
4. Commit: `docs: rewrite README for v0.3.0 sync model`

## Task 38: Update `package.json`

**Files:** `package.json`

**Steps:**
1. Bump version to `0.3.0`
2. Remove deleted commands from `scripts:`
3. Update `files:` array (remove `harness/guides`, `harness/policies`, `harness/registry.yaml`; add `.harness/` if you want to ship the dogfooded structure — typically no)
4. Commit: `chore: bump version to 0.3.0`

## Task 39: Final test run + tag

**Steps:**
1. `npm test` — all pass
2. `git log --oneline` — sanity check
3. `git tag v0.3.0`
4. User handles `npm publish` (not automated by this plan)

---

## Self-Review Checklist (Completed Inline)

**Spec coverage:**

| Spec section | Covered by task(s) |
|---|---|
| Directory structure | Task 11 (import creates tree) |
| LLM profiles | Task 3 |
| sync command + flags | Tasks 14, 16 |
| Direction semantics | Task 14 (basic), Task 24 (conflicts) |
| Classification prompts | Task 11 (via `classifyAmbiguous`) + Task 16 (CLI wiring) |
| First-run vs steady-state | Task 17 (e2e) |
| Common-content extraction | Tasks 18, 19, 20 |
| Import-stub format | Task 10 |
| Concat-stub format w/ BEGIN/END | Task 10 |
| Symlink mode | Tasks 25, 28 |
| Copy+marker mode | Task 28 |
| Plugins format + semantics | Tasks 30–34 |
| `.sync-state.json` | Task 7 |
| `.harness/.gitignore` | Task 11 |
| Backups | Task 8 |
| Revert | Task 15 |
| Drift detection per asset | Tasks 13, 29, 33 |
| Drift pull-back | Tasks 22, 23, 29 |
| Clean break from legacy | Task 1 |
| Dogfood bootstrap | Tasks 35–39 |

**Type consistency:** function names reused in later tasks match Phase 1 definitions. `runSync`, `importInstructions`, `exportInstructions`, `detectInstructionDrift`, `createBackup`/`restoreBackup`/`listBackups`, `loadState`/`saveState` are consistent across all task references.

**Placeholder check:** every Phase 1 task has exact file paths, complete code, commit messages. Phases 2–5 are task-level (not step-level) because they depend on Phase 1 patterns being internalized first — an engineer finishing Phase 1 has the idioms and test patterns they need to execute Phases 2–5 autonomously.

**Scope:** Phase 1 alone is a working tool. Each subsequent phase layers functionality without breaking earlier phases. If Phase 2–5 proves too loose during execution, stop and call back to writing-plans to expand any phase into step-level detail.

---

## Execution Notes

- **Worktree**: This plan should run in a dedicated git worktree created from `main`. Use `superpowers:using-git-worktrees` to set one up before starting Task 1.
- **Commits**: every task ends with a commit. Do not batch. Atomic history is essential for `git bisect` later.
- **Tests**: run `npm test` after every task. Never leave failing tests between tasks.
- **Pause points**: the end of each phase is a safe pause point. If context fills up, stop, commit, restart with executing-plans pointing at the next phase.
- **Phase 1 is binding**: Phases 2–5 assume Phase 1 code exists exactly as written. If you change Phase 1 signatures during execution, update Phases 2–5 references before proceeding.
