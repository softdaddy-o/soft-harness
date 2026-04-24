const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listBackups } = require('../src/backup');
const { loadState } = require('../src/state');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { runSync } = require('../src/sync');
const { copyFixture, makeTempDir } = require('./helpers');

test('sync: first run imports instruction files, exports stubs, and saves state', async () => {
    const root = copyFixture('e2e-mixed');
    const result = await runSync(root, {}, {});

    assert.equal(result.phase, 'completed');
    assert.equal(result.imported.filter((item) => item.to && item.to.startsWith('.harness/llm/')).length, 2);
    assert.equal(result.pulledBack.length, 0);
    assert.equal(fs.existsSync(path.join(root, '.harness', 'HARNESS.md')), true);
    assert.match(readUtf8(path.join(root, 'CLAUDE.md')), /Managed by soft-harness/);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /BEGIN HARNESS.md/);

    const state = loadState(root);
    assert.equal(state.assets.instructions.length, 4);
    assert.ok(state.assets.instructions.some((entry) => entry.target === '.claude/CLAUDE.md'));
    assert.ok(state.assets.instructions.some((entry) => entry.target === 'GEMINI.md'));
    assert.ok(Array.isArray(state.assets.skills));
    assert.ok(Array.isArray(state.assets.agents));
    assert.ok(listBackups(root).length >= 1);
    assert.ok(result.details.imports.some((entry) => entry.action === 'adopt'));
});

test('sync: first interactive sync requests adoption and common-section review', async () => {
    const root = makeTempDir('soft-harness-first-sync-review-');
    writeUtf8(path.join(root, 'CLAUDE.md'), '## Common\nsame\n\n## Claude\nonly');
    writeUtf8(path.join(root, 'AGENTS.md'), '## Common\nsame\n\n## Codex\nonly');

    const prompts = [];
    await runSync(root, {
        interactive: true,
        confirm(question) {
            prompts.push(question);
            return true;
        }
    }, {});

    assert.ok(prompts.some((question) => question.includes('Adopt CLAUDE.md')));
    assert.ok(prompts.some((question) => question.includes('Promote section "Common"')));
});

test('sync: dry-run reports instruction drift after manual root edit', async () => {
    const root = copyFixture('e2e-mixed');
    await runSync(root, {}, {});
    writeUtf8(path.join(root, 'CLAUDE.md'), `${readUtf8(path.join(root, 'CLAUDE.md'))}\nmanual edit\n`);

    const result = await runSync(root, { dryRun: true }, {});
    assert.equal(result.phase, 'dry-run');
    assert.ok(result.plan.drift.some((entry) => entry.relativePath === 'CLAUDE.md'));
});

test('sync: when both source and target change, dry-run reports a conflict', async () => {
    const root = copyFixture('e2e-mixed');
    await runSync(root, {}, {});

    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), `${readUtf8(path.join(root, '.harness', 'llm', 'claude.md'))}\nsource change\n`);
    writeUtf8(path.join(root, 'CLAUDE.md'), `${readUtf8(path.join(root, 'CLAUDE.md'))}\ntarget change\n`);

    const result = await runSync(root, { dryRun: true }, {});
    assert.ok(result.plan.conflicts.some((entry) => entry.relativePath === 'CLAUDE.md'));
});

test('sync: unresolved non-dry-run conflicts fail instead of overwriting targets', async () => {
    const root = copyFixture('e2e-mixed');
    await runSync(root, {}, {});

    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), `${readUtf8(path.join(root, '.harness', 'llm', 'claude.md'))}\nsource change\n`);
    writeUtf8(path.join(root, 'CLAUDE.md'), `${readUtf8(path.join(root, 'CLAUDE.md'))}\ntarget change\n`);

    await assert.rejects(() => runSync(root, {}, {}), /unresolved instruction conflicts/i);
});

test('sync: conflict resolution can import target-side edits back into .harness', async () => {
    const root = copyFixture('e2e-mixed');
    await runSync(root, {}, {});

    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), `${readUtf8(path.join(root, '.harness', 'llm', 'claude.md'))}\nsource change\n`);
    writeUtf8(path.join(root, 'CLAUDE.md'), `${readUtf8(path.join(root, 'CLAUDE.md'))}\nmanual import edit\n`);

    await runSync(root, {
        resolveConflict() {
            return 'import';
        }
    }, {});

    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'claude.md')), /manual import edit/);
});

test('sync: pull-back routes concat-stub edits back to llm source', async () => {
    const root = copyFixture('e2e-mixed');
    await runSync(root, {}, {});

    writeUtf8(path.join(root, 'AGENTS.md'), `${readUtf8(path.join(root, 'AGENTS.md'))}\nmanual tail\n`);
    await runSync(root, {}, {});

    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), /manual tail/);
});

test('sync: backup targets include existing harness assets and discovered project skills', async () => {
    const root = makeTempDir('soft-harness-sync-backups-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'built-in', 'SKILL.md'), '# Built In');
    writeUtf8(path.join(root, '.claude', 'skills', 'local', 'SKILL.md'), '# Local');

    const result = await runSync(root, {}, {});
    const backups = listBackups(root);
    const latest = backups[backups.length - 1];
    const manifest = JSON.parse(readUtf8(path.join(root, '.harness', 'backups', latest.timestamp, 'manifest.json')));

    assert.equal(result.phase, 'completed');
    assert.ok(manifest.entries.some((entry) => entry.path === '.harness/skills/claude/built-in'));
    assert.ok(manifest.entries.some((entry) => entry.path === '.claude/skills/built-in'));
    assert.ok(manifest.entries.some((entry) => entry.path === '.claude/skills/local'));
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
        '',
        'Help design resilient APIs, review architecture decisions, and guide backend implementation tradeoffs.',
        ''
    ].join('\n'));

    const result = await runSync(root, {}, {});

    assert.equal(result.phase, 'completed');
    assert.ok(result.imported.some((entry) => entry.to === '.harness/agents/codex/backend-architect.toml'));
    assert.ok(result.exported.some((entry) => entry.to === '.codex/agents/backend-architect.toml'));
    assert.match(readUtf8(path.join(root, '.harness', 'agents', 'codex', 'backend-architect.toml')), /name = "Backend Architect"/);
    assert.match(readUtf8(path.join(root, '.codex', 'agents', 'backend-architect.toml')), /developer_instructions = """/);
    assert.match(readUtf8(path.join(root, '.harness', 'asset-origins.yaml')), /Codex TOML agent/);
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
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'agents', 'codex', 'reviewer.yaml'), [
        'interface:',
        '  display_name: Reviewer',
        '  short_description: Reviews code.',
        '  default_prompt: Review code carefully.',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.codex', 'agents', 'reviewer.yaml'), [
        'interface:',
        '  display_name: Reviewer',
        ''
    ].join('\n'));

    const result = await runSync(root, {}, {});

    assert.equal(result.phase, 'completed');
    assert.ok(result.imported.some((entry) => entry.to === '.harness/agents/codex/reviewer.toml'));
    assert.ok(result.exported.some((entry) => entry.to === '.codex/agents/reviewer.toml'));
    assert.equal(fs.existsSync(path.join(root, '.harness', 'agents', 'codex', 'reviewer.yaml')), false);
    assert.equal(fs.existsSync(path.join(root, '.codex', 'agents', 'reviewer.yaml')), false);
    assert.match(readUtf8(path.join(root, '.codex', 'agents', 'reviewer.toml')), /name = "Reviewer"/);
});
