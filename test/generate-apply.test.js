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
