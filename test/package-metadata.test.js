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

test('plugin wrapper versions stay aligned with the published package version', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const claudeMarketplace = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
    const claudePlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.claude-plugin', 'plugin.json'), 'utf8'));
    const codexPlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.codex-plugin', 'plugin.json'), 'utf8'));

    const publishedVersion = packageJson.version;
    const marketplaceEntry = claudeMarketplace.plugins.find((plugin) => plugin.name === 'soft-harness');

    assert.ok(marketplaceEntry);
    assert.equal(marketplaceEntry.version, publishedVersion);
    assert.equal(claudePlugin.version, publishedVersion);
    assert.equal(codexPlugin.version, publishedVersion);
});
