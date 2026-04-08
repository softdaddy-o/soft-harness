const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { loadRegistry } = require('../src/registry');

const fixturesRoot = path.join(__dirname, 'fixtures');

test('loads base registry and imported registry.d files', () => {
    const projectRoot = path.join(fixturesRoot, 'valid-project');
    const loaded = loadRegistry(projectRoot);

    assert.equal(loaded.registry.capabilities.length, 2);
    assert.equal(loaded.registry.guides.shared.length, 1);
    assert.equal(loaded.registry.guides.claude.length, 1);
    assert.equal(loaded.registry.guides.codex.length, 1);
    assert.equal(loaded.issues.length, 0);
});

test('reports duplicate capability ids across imports', () => {
    const projectRoot = path.join(fixturesRoot, 'duplicate-id-project');
    const loaded = loadRegistry(projectRoot);

    assert.equal(loaded.issues.some((issue) => issue.code === 'duplicate-capability-id'), true);
});

test('reports invalid capability enums', () => {
    const projectRoot = path.join(fixturesRoot, 'invalid-capability-project');
    const loaded = loadRegistry(projectRoot);
    const codes = loaded.issues.map((issue) => issue.code);

    assert.equal(codes.includes('invalid-capability-kind'), true);
    assert.equal(codes.includes('invalid-capability-target'), true);
    assert.equal(codes.includes('invalid-capability-scope'), true);
    assert.equal(codes.includes('invalid-capability-management'), true);
});

test('reports guide entries that escape their bucket', () => {
    const projectRoot = path.join(fixturesRoot, 'invalid-guide-project');
    const loaded = loadRegistry(projectRoot);

    assert.equal(loaded.issues.some((issue) => issue.code === 'guide-path-outside-bucket'), true);
});

test('reports invalid output configuration', () => {
    const projectRoot = path.join(fixturesRoot, 'invalid-output-project');
    const loaded = loadRegistry(projectRoot);
    const codes = loaded.issues.map((issue) => issue.code);

    assert.equal(codes.includes('invalid-output-guide-buckets'), true);
    assert.equal(codes.includes('missing-output-generated-path'), true);
    assert.equal(codes.includes('invalid-output-apply-mode'), true);
});

test('resolves known output presets', () => {
    const projectRoot = path.join(fixturesRoot, 'preset-project');
    const loaded = loadRegistry(projectRoot);

    assert.equal(loaded.registry.outputs[0].generated_path, './generated/project/codex/AGENTS.generated.md');
    assert.equal(loaded.registry.outputs[0].apply_path, '../AGENTS.md');
    assert.equal(loaded.registry.outputs[1].generated_path, './generated/project/claude/CLAUDE.generated.md');
    assert.equal(loaded.issues.length, 0);
});
