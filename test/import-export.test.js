const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildInstructionExports, exportInstructions } = require('../src/export');
const { importInstructions } = require('../src/import');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('import: first run extracts common content and llm-specific content', async () => {
    const root = makeTempDir('soft-harness-import-');
    writeUtf8(path.join(root, 'CLAUDE.md'), '## Common\nsame\n\n## Claude\nonly');
    writeUtf8(path.join(root, 'AGENTS.md'), '## Common\nsame\n\n## Codex\nonly');

    const result = await importInstructions(root, [
        {
            llm: 'claude',
            relativePath: 'CLAUDE.md',
            absolutePath: path.join(root, 'CLAUDE.md')
        },
        {
            llm: 'codex',
            relativePath: 'AGENTS.md',
            absolutePath: path.join(root, 'AGENTS.md')
        }
    ], {});

    assert.equal(result.imported.length, 2);
    assert.match(readUtf8(path.join(root, '.harness', 'HARNESS.md')), /## Common/);
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'claude.md')), /## Claude/);
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), /## Codex/);
    assert.ok(result.routes.some((entry) => entry.action === 'extract-common' && entry.to === '.harness/HARNESS.md'));
});

test('export: builds expected root instruction files from harness sources', () => {
    const root = makeTempDir('soft-harness-export-');
    writeUtf8(path.join(root, '.harness', 'HARNESS.md'), '# Shared');
    writeUtf8(path.join(root, '.harness', 'llm', 'codex.md'), '# Codex');

    const plan = buildInstructionExports(root, { state: { assets: { instructions: [] } } });
    assert.ok(plan.some((entry) => entry.relativePath === 'AGENTS.md'));

    const result = exportInstructions(root, { state: { assets: { instructions: [] } } });
    assert.equal(result.exported.length, 1);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /BEGIN HARNESS.md/);
    assert.ok(result.routes.some((entry) => entry.action === 'export-instruction' && entry.to === 'AGENTS.md'));
});
