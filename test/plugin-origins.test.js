const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMemoryFs } = require('./helpers');
const { findPluginOrigin, loadPluginOrigins, loadPluginOriginsInput, savePluginOrigins } = require('../src/plugin-origins');
const { compareVersions } = require('../src/version');

test('plugin-origins: save/load roundtrips normalized github repo metadata', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-plugin-origins-roundtrip-root');
        savePluginOrigins(root, [{
            plugin: 'frontend-design@claude-code-plugins',
            hosts: ['claude'],
            sourceType: 'github',
            repo: 'acme/frontend-design',
            latestVersion: '1.4.0',
            confidence: 'llm-inferred'
        }]);

        const origins = loadPluginOrigins(root);
        assert.deepEqual(origins, [{
            plugin: 'frontend-design@claude-code-plugins',
            hosts: ['claude'],
            sourceType: 'github',
            repo: 'acme/frontend-design',
            url: 'https://github.com/acme/frontend-design',
            latestVersion: '1.4.0',
            confidence: 'llm-inferred',
            notes: null
        }]);
    });
});

test('plugin-origins: input loader supports yaml and matching falls back to plain plugin name', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-plugin-origins-input-root');
        memoryFs.writeTree(root, {
            'origins.yaml': [
                'plugin_origins:',
                '  - plugin: shared-plugin',
                '    hosts: [claude, codex]',
                '    source_type: github',
                '    repo: softdaddy-o/shared-plugin',
                '    latest_version: 1.2.0',
                ''
            ].join('\n')
        });

        const origins = loadPluginOriginsInput(path.join(root, 'origins.yaml'));
        const match = findPluginOrigin(origins, 'claude', {
            name: 'shared-plugin',
            displayName: 'shared-plugin@registry'
        });

        assert.equal(match.repo, 'softdaddy-o/shared-plugin');
        assert.equal(match.url, 'https://github.com/softdaddy-o/shared-plugin');
    });
});

test('version: compareVersions handles release and prerelease values', () => {
    assert.equal(compareVersions('1.0.0', '1.2.0'), -1);
    assert.equal(compareVersions('2.0.0', '1.2.0'), 1);
    assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), -1);
    assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
    assert.equal(compareVersions('not-a-version', '1.2.0'), null);
});
