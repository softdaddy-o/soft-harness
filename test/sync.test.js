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
    assert.equal(state.assets.instructions.length, 3);
    assert.ok(state.assets.instructions.some((entry) => entry.target === '.claude/CLAUDE.md'));
    assert.ok(listBackups(root).length >= 1);
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
