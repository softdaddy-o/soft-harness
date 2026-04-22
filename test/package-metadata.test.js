const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package metadata includes plugin wrappers and shared plugin content in published files', () => {
    const pkg = require(path.join('..', 'package.json'));
    assert.ok(pkg.files.includes('.agents'));
    assert.ok(pkg.files.includes('.claude-plugin'));
    assert.ok(pkg.files.includes('plugins'));
    assert.ok(pkg.files.includes('scripts'));
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

test('publish-facing versions stay aligned with package.json', () => {
    const pkg = require(path.join('..', 'package.json'));
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
    const marketplace = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
    const claudePlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.claude-plugin', 'plugin.json'), 'utf8'));
    const codexPlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.codex-plugin', 'plugin.json'), 'utf8'));

    assert.equal(lock.version, pkg.version);
    assert.equal(lock.packages[''].version, pkg.version);
    assert.equal(marketplace.plugins[0].version, pkg.version);
    assert.equal(claudePlugin.version, pkg.version);
    assert.equal(codexPlugin.version, pkg.version);
});
