const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package metadata includes plugin wrappers and shared plugin content in published files', () => {
    const pkg = require(path.join('..', 'package.json'));
    assert.ok(pkg.files.includes('.agents'));
    assert.ok(pkg.files.includes('.claude-plugin'));
    assert.ok(pkg.files.includes('plugins'));
    assert.equal(pkg.bin['soft-harness'], 'src/cli.js');
});

test('plugin wrapper manifests and marketplaces are valid json', () => {
    const files = [
        '.claude-plugin/marketplace.json',
        '.agents/plugins/marketplace.json',
        'plugins/soft-harness/.claude-plugin/plugin.json',
        'plugins/soft-harness/.codex-plugin/plugin.json'
    ];

    for (const relativePath of files) {
        const absolutePath = path.join(__dirname, '..', relativePath);
        const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        assert.equal(typeof parsed, 'object', relativePath);
    }
});
