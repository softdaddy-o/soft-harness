# Plugin Skill Structure And Export Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve original Claude plugin `skills/` structure when porting to Codex, normalize exported `SKILL.md` frontmatter, and harden generated Codex agent TOML so issues `#7`, `#11`, `#12`, and `#13` are fixed together.

**Architecture:** Keep `src/skills.js` as the primary import/export orchestrator, but extend it from file-level copies to structure-aware plugin skill tree migration. Add serializer helpers that normalize `SKILL.md` frontmatter and TOML output at write time, then cover the new behavior with focused `skills` and `sync` tests before the full suite.

**Tech Stack:** Node.js, CommonJS, built-in `node:test`, `yaml`

---

### Task 1: Lock The New Serializer Behavior With Failing Tests

**Files:**
- Modify: `test/skills.test.js`

- [ ] **Step 1: Write the failing `SKILL.md` frontmatter and agent TOML tests**

Add tests that assert:
- a `description` containing `: ` is rewritten as a double-quoted YAML value
- a missing or blank `description` gets a fallback from body text
- Codex agent TOML escapes control characters instead of writing raw invalid bytes
- Codex agent TOML never emits `description = ""`

```js
test('skills: exported codex skill descriptions are quoted and backfilled', () => {
    const root = makeProjectTree('soft-harness-skill-description-normalize-', {
        '.harness': {
            skills: {
                codex: {
                    analyze: {
                        'SKILL.md': [
                            '---',
                            'name: Analyze',
                            'description: Review state: compare prompts safely.',
                            '---',
                            '',
                            'Inspect the current setup carefully.',
                            ''
                        ].join('\n')
                    },
                    organize: {
                        'SKILL.md': [
                            '# Organize',
                            '',
                            'Apply host changes and refresh harness state.',
                            ''
                        ].join('\n')
                    }
                }
            }
        }
    });

    exportSkillsAndAgents(root, {});

    const analyzeSkill = readUtf8(path.join(root, '.codex', 'skills', 'analyze', 'SKILL.md'));
    const organizeSkill = readUtf8(path.join(root, '.codex', 'skills', 'organize', 'SKILL.md'));
    assert.match(analyzeSkill, /description: "Review state: compare prompts safely\."$/m);
    assert.match(organizeSkill, /^description: ".+"/m);
});

test('skills: codex agent toml escapes control characters and backfills description', () => {
    const root = makeProjectTree('soft-harness-agent-toml-safety-', {
        '.claude': {
            agents: {
                'unsafe.md': [
                    '---',
                    'name: Unsafe',
                    'description:   ',
                    '---',
                    '',
                    '# Unsafe',
                    '',
                    `First paragraph with control ${String.fromCharCode(1)} character.`,
                    ''
                ].join('\n')
            }
        }
    });

    importSkillsAndAgents(root, {});

    const toml = readUtf8(path.join(root, '.harness', 'agents', 'codex', 'unsafe.toml'));
    assert.doesNotMatch(toml, /description = ""/);
    assert.match(toml, /description = ".+"/);
    assert.match(toml, /\\u0001/);
});
```

- [ ] **Step 2: Run the focused serializer tests and verify they fail for the intended reasons**

Run: `node --test test/skills.test.js`

Expected: FAIL with missing quote/fallback behavior in exported `SKILL.md` and missing control-character or description safeguards in generated TOML.

- [ ] **Step 3: Commit the red tests**

```bash
git add test/skills.test.js
git commit -m "test: lock export serialization behavior"
```

### Task 2: Implement Safe `SKILL.md` And TOML Serializers

**Files:**
- Modify: `src/skills.js`
- Test: `test/skills.test.js`

- [ ] **Step 1: Add focused helper functions near the existing frontmatter and TOML helpers**

Extend `src/skills.js` around the current `buildCodexAgentToml`, `parseClaudeAgentMarkdown`, and `extractFrontmatter` helpers with small serializer primitives:

```js
function deriveDescriptionFallback(name, body) {
    const paragraph = body
        .split(/\r?\n\r?\n/u)
        .map((chunk) => chunk.replace(/^#+\s*/u, '').trim())
        .find((chunk) => chunk);
    if (paragraph) {
        return paragraph.replace(/\s+/gu, ' ').trim();
    }
    return name.replace(/[-_]+/gu, ' ').trim() || 'Managed skill';
}

function toQuotedYamlString(value) {
    return `"${String(value)
        .replace(/\\/gu, '\\\\')
        .replace(/"/gu, '\\"')}"`;
}

function sanitizeTomlText(value) {
    return String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, (character) => {
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
}
```

- [ ] **Step 2: Normalize exported `SKILL.md` content before writing copy-mode targets**

Teach the skill export path to rewrite `SKILL.md` instead of blindly copying it:

```js
function normalizeSkillMarkdown(content, fallbackName) {
    const parsed = extractFrontmatter(content);
    const name = (parsed.data.name || fallbackName || '').trim();
    const description = (parsed.data.description || '').trim() || deriveDescriptionFallback(name, parsed.body);
    const frontmatter = {
        ...parsed.data,
        ...(name ? { name } : {}),
        description
    };
    return [
        '---',
        ...Object.entries(frontmatter).map(([key, value]) => {
            if (key === 'description') {
                return `${key}: ${toQuotedYamlString(value)}`;
            }
            return `${key}: ${String(value)}`;
        }),
        '---',
        '',
        parsed.body.replace(/^\r?\n/u, '')
    ].join('\n');
}
```

Apply that helper only when writing `SKILL.md` files for managed exports so directory layout stays unchanged while `SKILL.md` becomes safe.

- [ ] **Step 3: Harden Codex agent TOML generation**

Update the current TOML builder to sanitize `developer_instructions` and backfill descriptions:

```js
function buildCodexAgentToml(content, fallbackName) {
    const parsed = parseClaudeAgentMarkdown(content, fallbackName);
    const safeDescription = (parsed.description || '').trim()
        || deriveDescriptionFallback(parsed.name || fallbackName, parsed.body);
    return [
        `name = ${toTomlBasicString(parsed.name || fallbackName)}`,
        `description = ${toTomlBasicString(sanitizeTomlText(safeDescription))}`,
        `developer_instructions = ${toTomlMultilineString(sanitizeTomlText(parsed.body))}`,
        ''
    ].join('\n');
}
```

- [ ] **Step 4: Re-run the focused serializer tests and verify they pass**

Run: `node --test test/skills.test.js`

Expected: PASS with the new quoting, fallback, and TOML escaping behavior.

- [ ] **Step 5: Commit the serializer implementation**

```bash
git add src/skills.js test/skills.test.js
git commit -m "fix: normalize skill frontmatter and codex agent toml"
```

### Task 3: Lock Plugin Skill Tree Preservation With Failing Tests

**Files:**
- Modify: `test/skills.test.js`
- Modify: `test/sync.test.js`

- [ ] **Step 1: Add failing import/export tests for plugin skill subtree preservation**

Add a plugin fixture with:
- a plugin `skills/references/` directory
- one or more plugin skill directories with `SKILL.md`
- a companion file such as `visual-companion.md`
- a nested `agents/` or `scripts/` folder
- `SKILL.md` content that references `../references/...`

```js
test('skills: plugin codex skill migration preserves original subtree structure', () => {
    const pluginRoot = path.join('.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.0.7');
    const root = makeProjectTree('soft-harness-plugin-skill-structure-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers@claude-plugins-official',
                '    llms: [claude, codex]',
                ''
            ].join('\n')
        },
        '.claude': {
            'settings.json': JSON.stringify({ enabledPlugins: { 'superpowers@claude-plugins-official': true } }, null, 2),
            plugins: {
                'installed_plugins.json': JSON.stringify({
                    version: 2,
                    plugins: {
                        'superpowers@claude-plugins-official': [{
                            version: '5.0.7',
                            installPath: pluginRoot
                        }]
                    }
                }, null, 2),
                cache: {
                    'claude-plugins-official': {
                        superpowers: {
                            '5.0.7': {
                                skills: {
                                    references: {
                                        'helper-surface.md': '# Helper'
                                    },
                                    analyze: {
                                        'SKILL.md': [
                                            '---',
                                            'name: Analyze',
                                            'description: Review state: compare prompts safely.',
                                            '---',
                                            '',
                                            'See `../references/helper-surface.md`.',
                                            ''
                                        ].join('\n'),
                                        'visual-companion.md': '# Visual',
                                        scripts: {
                                            'collect.js': 'console.log(\"collect\");'
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const imported = importSkillsAndAgents(root, {});
    exportSkillsAndAgents(root, {});

    assert.ok(imported.imported.some((entry) => entry.to === '.harness/skills/codex/analyze'));
    assert.equal(exists(path.join(root, '.harness', 'skills', 'codex', 'references', 'helper-surface.md')), true);
    assert.equal(exists(path.join(root, '.harness', 'skills', 'codex', 'analyze', 'visual-companion.md')), true);
    assert.equal(exists(path.join(root, '.codex', 'skills', 'references', 'helper-surface.md')), true);
    assert.equal(exists(path.join(root, '.codex', 'skills', 'analyze', 'scripts', 'collect.js')), true);
});
```

- [ ] **Step 2: Add a sync-level regression test**

Extend `test/sync.test.js` so `runSync()` proves the migrated plugin tree survives the full organize flow and preserves shared references under `.codex/skills/`.

- [ ] **Step 3: Run the plugin-skill focused tests and verify they fail**

Run: `node --test test/skills.test.js test/sync.test.js`

Expected: FAIL because plugin skills are not yet imported/exported as a preserved subtree.

- [ ] **Step 4: Commit the red plugin tree tests**

```bash
git add test/skills.test.js test/sync.test.js
git commit -m "test: cover plugin skill subtree migration"
```

### Task 4: Implement Plugin Skill Tree Migration And Validation

**Files:**
- Modify: `src/skills.js`
- Modify: `src/asset-origins.js` only if a new field-normalization helper is required
- Test: `test/skills.test.js`
- Test: `test/sync.test.js`

- [ ] **Step 1: Add plugin skill source discovery using installed plugin `skills/` roots**

Follow the current plugin agent pattern, but for directories:

```js
function discoverClaudePluginSkillsForCodex(rootDir) {
    const desired = loadPlugins(rootDir).filter((plugin) => Array.isArray(plugin.llms) && plugin.llms.includes('codex'));
    const installed = readInstalledPluginEntries(rootDir, 'claude');
    const discovered = [];

    for (const plugin of desired) {
        const installedEntry = matchInstalledClaudePlugin(plugin, installed);
        if (!installedEntry || !installedEntry.installPath) {
            continue;
        }

        const skillsRoot = path.join(resolveInstallRoot(rootDir, installedEntry.installPath), 'skills');
        if (!exists(skillsRoot)) {
            continue;
        }
        discovered.push({ plugin: installedEntry, skillsRoot });
    }

    return discovered;
}
```

- [ ] **Step 2: Compute the preserved plugin subtree that must come across**

Add a small tree collector that:
- finds skill directories containing `SKILL.md`
- copies sibling shared directories like `references/`
- preserves nested files under each selected skill directory
- records source-relative paths for origins and export

```js
function collectPluginSkillTreeMembers(skillsRoot) {
    const members = [];
    for (const entry of getFsBackend().readdirSync(skillsRoot, { withFileTypes: true })) {
        const absolutePath = path.join(skillsRoot, entry.name);
        if (!entry.isDirectory()) {
            continue;
        }
        if (exists(path.join(absolutePath, 'SKILL.md')) || entry.name === 'references') {
            members.push({
                name: entry.name,
                absolutePath,
                relativePath: toPosixRelative(skillsRoot, absolutePath)
            });
        }
    }
    return members;
}
```

- [ ] **Step 3: Import the preserved tree into `.harness/skills/codex/` and record origins**

Create an import path parallel to the existing agent port:
- copy each selected directory into `.harness/skills/codex/<relative>`
- normalize any copied `SKILL.md`
- upsert asset origins for each migrated skill directory with plugin name, installed version, repo, and plugin-local source path

```js
const relativeTarget = `.harness/skills/codex/${member.relativePath}`;
copyPath(member.absolutePath, path.join(rootDir, relativeTarget));
normalizeSkillFileInTree(path.join(rootDir, relativeTarget), member.name);
upsertAssetOrigin(assetOrigins, {
    kind: 'skill',
    asset: member.name,
    hosts: ['codex'],
    plugin: installedEntry.name,
    installedVersion: installedEntry.version || null,
    sourceType: 'plugin',
    sourcePath: joinSourcePath(plugin.sourcePath, `skills/${member.relativePath}`)
});
```

- [ ] **Step 4: Validate exported local references after writing managed skill targets**

After export, parse each managed `SKILL.md`, collect obvious local markdown references like `` `../references/foo.md` `` and link targets like `[x](../references/foo.md)`, and assert the referenced file exists relative to the exported skill directory. Raise a clear error for missing companions so shallow copies are caught immediately.

```js
function validateExportedSkillTree(skillDir) {
    const skillPath = path.join(skillDir, 'SKILL.md');
    if (!exists(skillPath)) {
        return;
    }
    const content = readUtf8(skillPath);
    for (const relativeRef of collectLocalMarkdownReferences(content)) {
        const absoluteRef = path.resolve(skillDir, relativeRef);
        if (!exists(absoluteRef)) {
            throw new Error(`managed skill export is missing referenced file: ${relativeRef}`);
        }
    }
}
```

- [ ] **Step 5: Re-run the plugin-skill focused tests and verify they pass**

Run: `node --test test/skills.test.js test/sync.test.js`

Expected: PASS with plugin skill trees preserved under both `.harness/skills/codex/` and `.codex/skills/`.

- [ ] **Step 6: Commit the plugin tree implementation**

```bash
git add src/skills.js test/skills.test.js test/sync.test.js
git commit -m "feat: preserve plugin skill trees for codex"
```

### Task 5: Full Verification And Release Readiness

**Files:**
- Modify: `docs/superpowers/plans/2026-04-25-plugin-skill-structure-and-export-safety.md` only to mark completed checkboxes during execution

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: PASS with `193` tests plus any newly added coverage, `0` failures.

- [ ] **Step 2: Inspect the diff for only the intended files**

Run: `git status --short`

Expected: changes limited to `src/skills.js`, the touched tests, and this plan file until version/release work starts.

- [ ] **Step 3: Prepare release commands after implementation is verified**

Run after code review and acceptance:

```bash
npm version patch
git push origin fix/issues-7-11-12-13-batch --follow-tags
```

- [ ] **Step 4: Commit the final verified work**

```bash
git add src/skills.js test/skills.test.js test/sync.test.js docs/superpowers/plans/2026-04-25-plugin-skill-structure-and-export-safety.md
git commit -m "feat: preserve plugin skill exports and harden serializers"
```
