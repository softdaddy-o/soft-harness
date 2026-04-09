const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { applyOutputs } = require('../src/apply');
const { generateOutputs } = require('../src/generate');
const { loadRegistry } = require('../src/registry');

test('generate writes output bundles and apply copies them to target paths', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-generate-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'generate-project'), tempRoot, { recursive: true });

    const loaded = loadRegistry(tempRoot);
    const generated = generateOutputs(tempRoot, loaded);
    assert.equal(generated.length, 2);

    const applied = applyOutputs(tempRoot, loaded);
    assert.equal(applied.length, 2);

    const codexTarget = path.join(tempRoot, 'AGENTS.harness.md');
    const claudeTarget = path.join(tempRoot, 'CLAUDE.harness.md');

    assert.equal(fs.existsSync(codexTarget), true);
    assert.equal(fs.existsSync(claudeTarget), true);

    const codexContent = fs.readFileSync(codexTarget, 'utf8');
    const claudeContent = fs.readFileSync(claudeTarget, 'utf8');

    assert.match(codexContent, /Project coding guide/);
    assert.match(claudeContent, /Claude memory guide/);
});

test('preset outputs resolve to real CLAUDE.md and AGENTS.md stubs', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-preset-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'preset-project'), tempRoot, { recursive: true });

    const loaded = loadRegistry(tempRoot);
    const generated = generateOutputs(tempRoot, loaded);
    assert.equal(generated.length, 2);

    const applied = applyOutputs(tempRoot, loaded);
    assert.equal(applied.length, 2);

    const agentsPath = path.join(tempRoot, 'AGENTS.md');
    const claudePath = path.join(tempRoot, 'CLAUDE.md');

    assert.equal(fs.existsSync(agentsPath), true);
    assert.equal(fs.existsSync(claudePath), true);
    assert.match(fs.readFileSync(agentsPath, 'utf8'), /Managed by soft-harness/);
    assert.match(fs.readFileSync(claudePath, 'utf8'), /Managed by soft-harness/);
});

test('account presets resolve to account-level v1 targets', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-account-preset-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'account-preset-project'), tempRoot, { recursive: true });

    const loaded = loadRegistry(tempRoot);
    const outputs = loaded.registry.outputs;
    assert.equal(outputs[0].apply_path.includes('{userHome}/.claude/CLAUDE.md'), true);
    assert.equal(outputs[1].apply_path.includes('{userHome}/AGENTS.md'), true);
});
