const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { importInstructions } = require('../src/import');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeProjectTree, makeTempDir } = require('./helpers');

test('import: empty discovery creates HARNESS.md when missing', async () => {
    const root = makeTempDir('soft-harness-import-empty-');
    const result = await importInstructions(root, [], {});

    assert.equal(result.imported.length, 0);
    assert.equal(result.writes[0].path, '.harness/HARNESS.md');
    assert.equal(exists(path.join(root, '.harness', 'HARNESS.md')), true);
});

test('import: empty discovery dry-run records harness write without touching disk', async () => {
    const root = makeTempDir('soft-harness-import-empty-dry-');
    const result = await importInstructions(root, [], { dryRun: true });

    assert.equal(result.writes.length, 1);
    assert.equal(exists(path.join(root, '.harness', 'HARNESS.md')), false);
});

test('import: review flow can reject adoption before extraction', async () => {
    const root = makeProjectTree('soft-harness-import-review-', {
        'CLAUDE.md': '## Shared\nsame\n\n## Claude Only\nonly\n',
        'AGENTS.md': '## Shared\nsame\n\n## Codex Only\nonly\n'
    });
    const discovered = [
        { llm: 'claude', relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') },
        { llm: 'codex', relativePath: 'AGENTS.md', absolutePath: path.join(root, 'AGENTS.md') }
    ];
    const prompts = [];
    const answers = [false, true];

    const result = await importInstructions(root, discovered, {
        firstSync: true,
        reviewImports: true,
        confirm(question) {
            prompts.push(question);
            return answers.shift();
        }
    });

    assert.equal(result.imported.length, 1);
    assert.equal(result.imported[0].llm, 'codex');
    assert.equal(readUtf8(path.join(root, '.harness', 'HARNESS.md')), '');
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), /Shared/);
    assert.ok(prompts.some((question) => question.includes('Adopt CLAUDE.md')));
});

test('import: review flow can reject common promotion and keep shared content llm-specific', async () => {
    const root = makeProjectTree('soft-harness-import-promote-', {
        'CLAUDE.md': '## Shared\nsame\n',
        'AGENTS.md': '## Shared\nsame\n'
    });
    const discovered = [
        { llm: 'claude', relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') },
        { llm: 'codex', relativePath: 'AGENTS.md', absolutePath: path.join(root, 'AGENTS.md') }
    ];
    const prompts = [];
    const answers = [true, true, false];

    await importInstructions(root, discovered, {
        firstSync: true,
        reviewImports: true,
        confirm(question) {
            prompts.push(question);
            return answers.shift();
        }
    });

    assert.equal(readUtf8(path.join(root, '.harness', 'HARNESS.md')), '');
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'claude.md')), /Shared/);
    assert.ok(prompts.some((question) => question.includes('Promote section "Shared"')));
});

test('import: existing harness only adopts missing llm file', async () => {
    const root = makeProjectTree('soft-harness-import-existing-', {
        '.harness': {
            'HARNESS.md': 'common'
        },
        'CLAUDE.md': 'claude current',
        'AGENTS.md': 'codex current'
    });
    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), 'already imported');
    const discovered = [
        { llm: 'claude', relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') },
        { llm: 'codex', relativePath: 'AGENTS.md', absolutePath: path.join(root, 'AGENTS.md') }
    ];

    const result = await importInstructions(root, discovered, {});

    assert.deepEqual(result.imported.map((entry) => entry.llm), ['codex']);
    assert.equal(readUtf8(path.join(root, '.harness', 'llm', 'claude.md')), 'already imported');
    assert.equal(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), 'codex current');
});

test('import: existing llm content can bootstrap missing HARNESS.md and yes skips prompts', async () => {
    const root = makeProjectTree('soft-harness-import-bootstrap-', {
        'CLAUDE.md': 'claude current'
    });
    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), 'already imported');
    const discovered = [
        { llm: 'claude', relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') }
    ];

    const result = await importInstructions(root, discovered, { reviewImports: true, yes: true });

    assert.equal(result.writes.some((entry) => entry.path === '.harness/HARNESS.md'), true);
    assert.equal(readUtf8(path.join(root, '.harness', 'HARNESS.md')), '');
});

test('import: yes auto-approves first-sync adoption prompts', async () => {
    const root = makeProjectTree('soft-harness-import-yes-', {
        'CLAUDE.md': '## Shared\nsame\n',
        'AGENTS.md': '## Shared\nsame\n'
    });
    const discovered = [
        { llm: 'claude', relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') },
        { llm: 'codex', relativePath: 'AGENTS.md', absolutePath: path.join(root, 'AGENTS.md') }
    ];

    const result = await importInstructions(root, discovered, {
        firstSync: true,
        reviewImports: true,
        yes: true
    });

    assert.equal(result.imported.length, 2);
});
