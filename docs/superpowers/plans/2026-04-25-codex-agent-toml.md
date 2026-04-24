# Codex Agent TOML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incorrect Codex YAML agent flow with TOML-based Codex agents in `.harness/agents/codex/*.toml` and `.codex/agents/*.toml`.

**Architecture:** Keep Claude agents as markdown sources, convert them losslessly into TOML at import time, and let the existing harness export/drift pipeline manage TOML files as the canonical Codex-agent representation. Preserve asset-origin tracking and add one-way cleanup for legacy managed YAML outputs.

**Tech Stack:** CommonJS Node.js, `node:test`, existing file/hash helpers, `@iarna/toml`

---

### Task 1: Lock failing tests around the new Codex TOML model

**Files:**
- Modify: `test/skills.test.js`
- Modify: `test/sync.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test('skills: import ports Claude markdown agents into codex toml agents', () => {
    const root = makeProjectTree('soft-harness-skills-agent-port-', {
        '.claude': {
            agents: {
                'backend-architect.md': [
                    '---',
                    'name: Backend Architect',
                    'description: Senior backend architect specializing in scalable system design.',
                    '---',
                    '',
                    '# Backend Architect',
                    '',
                    'You are a Backend Architect focused on distributed systems, reliability, and service boundaries.',
                    '',
                    'Help design resilient APIs, review architecture decisions, and guide backend implementation tradeoffs.',
                    ''
                ].join('\\n')
            }
        }
    });

    const imported = importSkillsAndAgents(root, {});
    assert.ok(imported.imported.some((entry) => entry.to === '.harness/agents/codex/backend-architect.toml'));
    const codexAgent = readUtf8(path.join(root, '.harness', 'agents', 'codex', 'backend-architect.toml'));
    assert.match(codexAgent, /name = "Backend Architect"/);
    assert.match(codexAgent, /description = "Senior backend architect specializing in scalable system design\\."/");
    assert.match(codexAgent, /developer_instructions = """[\\s\\S]*You are a Backend Architect focused on distributed systems/);
});

test('sync: organize ports Claude markdown agents into codex toml outputs', async () => {
    const root = makeTempDir('soft-harness-sync-agent-port-');
    writeUtf8(path.join(root, '.claude', 'agents', 'backend-architect.md'), [
        '---',
        'name: Backend Architect',
        'description: Senior backend architect specializing in scalable system design.',
        '---',
        '',
        '# Backend Architect',
        '',
        'You are a Backend Architect focused on distributed systems, reliability, and service boundaries.',
        ''
    ].join('\\n'));

    const result = await runSync(root, {}, {});
    assert.ok(result.imported.some((entry) => entry.to === '.harness/agents/codex/backend-architect.toml'));
    assert.ok(result.exported.some((entry) => entry.to === '.codex/agents/backend-architect.toml'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: FAIL because current code still writes `.yaml` Codex agents and YAML stub content.

- [ ] **Step 3: Write the plugin-agent and legacy-YAML replacement tests**

```js
test('skills: plugin Claude agents assigned to codex are ported into codex toml agents', () => {
    // Existing fixture shape, but expect .toml and developer_instructions.
});

test('sync: organize replaces managed legacy codex yaml agent export with toml', async () => {
    const root = makeTempDir('soft-harness-sync-agent-port-legacy-');
    writeUtf8(path.join(root, '.claude', 'agents', 'reviewer.md'), [
        '---',
        'name: Reviewer',
        'description: Reviews code.',
        '---',
        '',
        'Review code carefully.',
        ''
    ].join('\\n'));
    writeUtf8(path.join(root, '.harness', 'agents', 'codex', 'reviewer.yaml'), [
        'interface:',
        '  display_name: Reviewer',
        '  short_description: Reviews code.',
        '  default_prompt: Review code carefully.',
        ''
    ].join('\\n'));
    writeUtf8(path.join(root, '.codex', 'agents', 'reviewer.yaml'), 'interface:\\n  display_name: Reviewer\\n');

    const result = await runSync(root, {}, {});
    assert.ok(result.exported.some((entry) => entry.to === '.codex/agents/reviewer.toml'));
    assert.equal(exists(path.join(root, '.codex', 'agents', 'reviewer.yaml')), false);
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: FAIL on `.toml` expectations and legacy YAML cleanup expectations.

- [ ] **Step 5: Commit**

```bash
git add test/skills.test.js test/sync.test.js
git commit -m "test: codify Codex TOML agent behavior"
```

### Task 2: Implement TOML conversion and Codex-agent canonicalization

**Files:**
- Modify: `src/skills.js`

- [ ] **Step 1: Write the failing unit expectation for TOML parsing helpers if needed**

```js
// Add the smallest helper-facing assertion through existing public behavior
// instead of exporting new internals unless the file truly needs it.
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: FAIL remains on TOML behavior.

- [ ] **Step 3: Write minimal implementation**

```js
const TOML = require('@iarna/toml');

function buildCodexAgentToml(content, fallbackName) {
    const parsed = parseClaudeAgentMarkdown(content, fallbackName);
    return TOML.stringify({
        name: parsed.displayName,
        description: parsed.shortDescription,
        developer_instructions: parsed.developerInstructions
    });
}

function parseClaudeAgentMarkdown(content, fallbackName) {
    const parsed = extractFrontmatter(content);
    const frontmatter = parsed.frontmatter || {};
    const body = parsed.body || '';
    const displayName = cleanText(frontmatter.name) || extractTitle(body) || titleizeSlug(fallbackName);
    const shortDescription = truncateText(cleanText(frontmatter.description) || extractFirstMeaningfulParagraph(body) || `Claude agent for ${displayName}.`, 220);
    return {
        displayName,
        shortDescription,
        developerInstructions: body.replace(/^\\s+|\\s+$/gu, '')
    };
}
```

Also in this task:

- change Codex-supported extensions to `.toml`
- write `.harness/agents/codex/<name>.toml`
- export `.codex/agents/<name>.toml`
- update origin notes from lossy YAML wording to TOML conversion wording
- remove managed legacy `.yaml` snapshot/export files when replacing them

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: PASS for the updated TOML-focused tests.

- [ ] **Step 5: Commit**

```bash
git add src/skills.js test/skills.test.js test/sync.test.js
git commit -m "feat: port Codex agents as toml"
```

### Task 3: Update remaining Codex-agent assumptions in evals and fixtures

**Files:**
- Modify: `src/skill-eval.js`
- Modify: `test/skills.test.js`
- Modify: `test/sync.test.js`

- [ ] **Step 1: Write the failing eval and fixture expectations**

```js
expect(exists(path.join(root, '.codex', 'agents', 'reviewer.toml')), 'Codex TOML agent snapshot should export to Codex');
writeUtf8(path.join(root, '.harness', 'agents', 'codex', 'reviewer.toml'), [
    'name = "Reviewer"',
    'description = "Reviews code."',
    'developer_instructions = """',
    'Review code carefully.',
    '"""',
    ''
].join('\\n'));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: FAIL if any YAML-based assumptions remain.

- [ ] **Step 3: Write minimal implementation**

```js
// Replace any remaining reviewer.yaml assumptions with reviewer.toml
// in skill eval fixtures and assertions.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: PASS with no YAML Codex-agent assumptions left in those files.

- [ ] **Step 5: Commit**

```bash
git add src/skill-eval.js test/skills.test.js test/sync.test.js
git commit -m "test: align evals with Codex TOML agents"
```

### Task 4: Full verification

**Files:**
- Modify: `docs/superpowers/plans/2026-04-25-codex-agent-toml.md`

- [ ] **Step 1: Run the focused suite**

Run: `node --test test/skills.test.js test/sync.test.js`
Expected: PASS with 0 failures.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS with 0 failures.

- [ ] **Step 3: Update the plan checklist**

```md
- [x] **Step 1: Run the focused suite**
- [x] **Step 2: Run the full test suite**
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-04-25-codex-agent-toml.md
git commit -m "docs: mark Codex TOML plan complete"
```
