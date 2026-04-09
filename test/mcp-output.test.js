const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { generateOutputs } = require('../src/generate');
const { loadRegistry } = require('../src/registry');

test('generate writes project mcp output from mcp capabilities', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-mcp-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'mcp-project'), tempRoot, { recursive: true });

    const loaded = loadRegistry(tempRoot);
    const generated = generateOutputs(tempRoot, loaded);

    assert.equal(generated.length, 1);
    const content = fs.readFileSync(generated[0].applyPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(typeof parsed.mcpServers.demo, 'object');
    assert.equal(parsed.mcpServers.demo.command, 'demo-server');
});
