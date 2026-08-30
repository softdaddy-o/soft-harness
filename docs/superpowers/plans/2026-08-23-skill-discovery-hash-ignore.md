# Skill Discovery Hash Ignore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make account-level skill discovery skip regenerated dependency and VCS trees while continuing to detect authored skill-file changes.

**Architecture:** `src/hash.js` retains its generic caller-provided ignore behavior. `src/skills.js` owns a private skill-discovery ignore list and passes it only when `discoverSkillsAndAgents` hashes a host skill; import, export, copy, and managed-tree equality continue to process complete trees. Two host skills that differ only inside the excluded trees intentionally classify as common, and the copied `.harness` source retains the selected complete tree.

**Tech Stack:** Node.js 20+, `node:test`, `node:assert/strict`, native filesystem fixtures.

---

### Task 1: Lock down generic directory-hash behavior

**Files:**
- Modify: `test/hash.test.js`

- [ ] **Step 1: Add failing nested-directory behavior tests**

Append these tests to `test/hash.test.js`:

```js
test('hash: hashDirectory skips ignored nested directories before traversal', () => {
    const dir = makeTempDir('soft-harness-dirhash-ignore-nested-');
    fs.mkdirSync(path.join(dir, 'support', 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(dir, 'support', 'node_modules', 'first.js'), 'first');

    const before = hashDirectory(dir, { ignore: ['node_modules'] });
    fs.writeFileSync(path.join(dir, 'support', 'node_modules', 'second.js'), 'second');
    const after = hashDirectory(dir, { ignore: ['node_modules'] });

    assert.equal(after, before);
});

test('hash: hashDirectory includes ignored-name directories unless asked to skip them', () => {
    const dir = makeTempDir('soft-harness-dirhash-default-nested-');
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), '# Skill');
    fs.writeFileSync(path.join(dir, 'node_modules', 'first.js'), 'first');

    const before = hashDirectory(dir);
    fs.writeFileSync(path.join(dir, 'node_modules', 'first.js'), 'changed');

    assert.notEqual(hashDirectory(dir), before);
});
```

- [ ] **Step 2: Run the focused tests and verify the current contract**

Run: `node --test test/hash.test.js`

Expected: PASS. `hashDirectory` already skips a matching basename before recursion when its caller supplies `ignore`; it must not gain a global default ignore list.

- [ ] **Step 3: Commit the contract tests**

```powershell
git add test/hash.test.js
git commit -m "test: cover nested directory hash ignores"
```

### Task 2: Prove skill-discovery-specific behavior before implementation

**Files:**
- Modify: `test/skills.test.js`
- Modify: `src/skills.js`

- [ ] **Step 1: Add a failing skill-discovery test**

Add this test near `skills: discovery skips invalid entries and imports agents during dry-run` in `test/skills.test.js`:

```js
test('skills: discovery ignores regenerated trees but hashes authored support files', () => {
    const root = makeProjectTree('soft-harness-skills-hash-ignore-', {
        '.claude': {
            skills: {
                sample: {
                    'SKILL.md': '# Sample',
                    scripts: {
                        'run.js': 'module.exports = 1;',
                        node_modules: {
                            package: {
                                'index.js': 'generated-v1'
                            }
                        }
                    },
                    '.git': {
                        HEAD: 'ref: refs/heads/main'
                    },
                    '__pycache__': {
                        'helper.pyc': 'bytecode-v1'
                    },
                    '.pytest_cache': {
                        README: 'cache-v1'
                    }
                }
            }
        }
    });

    const readHash = () => discoverSkillsAndAgents(root).find((item) => item.name === 'sample').hash;
    const baseline = readHash();

    writeUtf8(path.join(root, '.claude', 'skills', 'sample', 'scripts', 'node_modules', 'package', 'index.js'), 'generated-v2');
    writeUtf8(path.join(root, '.claude', 'skills', 'sample', '.git', 'HEAD'), 'ref: refs/heads/other');
    writeUtf8(path.join(root, '.claude', 'skills', 'sample', '__pycache__', 'helper.pyc'), 'bytecode-v2');
    writeUtf8(path.join(root, '.claude', 'skills', 'sample', '.pytest_cache', 'README'), 'cache-v2');

    assert.equal(readHash(), baseline);

    writeUtf8(path.join(root, '.claude', 'skills', 'sample', 'scripts', 'run.js'), 'module.exports = 2;');
    assert.notEqual(readHash(), baseline);
});
```

Add this second test immediately after it:

```js
test('skills: import groups host skills that differ only in regenerated trees', () => {
    const root = makeProjectTree('soft-harness-skills-common-ignore-', {
        '.claude': {
            skills: {
                sample: {
                    'SKILL.md': '# Sample',
                    scripts: {
                        'run.js': 'module.exports = 1;',
                        node_modules: {
                            package: { 'index.js': 'claude-generated' }
                        }
                    }
                }
            }
        },
        '.codex': {
            skills: {
                sample: {
                    'SKILL.md': '# Sample',
                    scripts: {
                        'run.js': 'module.exports = 1;',
                        node_modules: {
                            package: { 'index.js': 'codex-generated' }
                        }
                    }
                }
            }
        }
    });

    importSkillsAndAgents(root, {});

    assert.equal(exists(path.join(root, '.harness', 'skills', 'common', 'sample', 'SKILL.md')), true);
    assert.equal(exists(path.join(root, '.harness', 'skills', 'claude', 'sample')), false);
    assert.equal(exists(path.join(root, '.harness', 'skills', 'codex', 'sample')), false);
});
```

- [ ] **Step 2: Run the focused test and observe the failure**

Run: `node --test --test-name-pattern="discovery ignores regenerated" test/skills.test.js`

Expected: FAIL at `assert.equal(readHash(), baseline)` because the current discovery call hashes all files under the skill directory; the new common-bucket test also fails because the two host hashes differ.

- [ ] **Step 3: Add the discovery-only ignore policy**

In `src/skills.js`, immediately after the imports, add:

```js
const SKILL_DISCOVERY_HASH_IGNORES = ['.git', 'node_modules', '__pycache__', '.pytest_cache'];
```

In `discoverSkillsAndAgents`, replace:

```js
hash: hashDirectory(skillDir)
```

with:

```js
hash: hashDirectory(skillDir, { ignore: SKILL_DISCOVERY_HASH_IGNORES })
```

Do not export the constant and do not pass it to `copyPath`, `managedSkillTreesEqual`, import, export, or drift code.

- [ ] **Step 4: Run focused tests to verify the fix**

Run: `node --test test/hash.test.js test/skills.test.js`

Expected: PASS, including the new discovery test and all pre-existing hash and skill behavior tests.

- [ ] **Step 5: Commit the implementation**

```powershell
git add src/skills.js test/skills.test.js
git commit -m "perf: skip regenerated trees during skill discovery"
```

### Task 3: Verify the full package and the original account-level symptom

**Files:**
- Modify: none

- [ ] **Step 1: Run the full deterministic suite**

Run: `npm test`

Expected: PASS with zero failures.

- [ ] **Step 2: Run an account analysis using the worktree CLI**

Run: `node src/cli.js analyze --account --category=skills --json`

Expected: a JSON report with no traversal error. This verifies the discovery path against the real account inventory without mutating it.

- [ ] **Step 3: Measure the dry-run planning path without treating elapsed time as a correctness assertion**

Run: `node src/cli.js sync --account --dry-run --no-run-installs --no-run-uninstalls --verbose`

Expected: a printed plan rather than indefinite traversal of the `gstack` repository. Record the observed duration in the handoff, but do not add a time-sensitive automated test.

- [ ] **Step 4: Inspect the final diff and worktree state**

Run:

```powershell
git diff HEAD~1..HEAD --check
git status --short
git worktree list --porcelain
```

Expected: no whitespace errors; the implementation worktree is clean after commits; any retained worktree is named and intentional.
