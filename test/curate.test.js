const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createMemoryFs } = require('./helpers');
const { readUtf8 } = require('../src/fs-util');
const { parseCurateArgs, runCurate } = require('../src/curate');
const { runAnalyze } = require('../src/analyze');

test('curate: parseCurateArgs validates target and input', () => {
    assert.deepEqual(parseCurateArgs(['plugins', '--input=packet.json']), {
        target: 'plugins',
        input: 'packet.json',
        root: null,
        account: false
    });
    assert.throws(() => parseCurateArgs([]), /requires a target/);
    assert.throws(() => parseCurateArgs(['skills', '--input=packet.json']), /unsupported curate target/i);
    assert.throws(() => parseCurateArgs(['plugins']), /requires --input/i);
    assert.throws(() => parseCurateArgs(['plugins', '--root=', '--input=packet.json']), /--root requires a path/i);
    assert.throws(() => parseCurateArgs(['plugins', '--account', '--root=repo', '--input=packet.json']), /cannot combine --root and --account/i);
});

test('curate: plugin origins can be imported from an llm result file into .harness', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-curate-plugin-origins-root');
        memoryFs.writeTree(root, {
            '.harness': {},
            'plugin-research.json': JSON.stringify({
                plugin_origins: [{
                    plugin: 'frontend-design@claude-code-plugins',
                    hosts: ['claude'],
                    source_type: 'github',
                    repo: 'acme/frontend-design',
                    url: 'https://github.com/acme/frontend-design',
                    latest_version: '1.4.0',
                    confidence: 'llm-inferred',
                    notes: 'Matched from plugin title and repository metadata'
                }]
            }, null, 2)
        });

        const result = runCurate(root, {
            target: 'plugins',
            input: path.join(root, 'plugin-research.json')
        });

        assert.equal(result.updated, 1);
        assert.match(readUtf8(path.join(root, '.harness', 'plugin-origins.yaml')), /frontend-design@claude-code-plugins/);
        assert.match(readUtf8(path.join(root, '.harness', 'plugin-origins.yaml')), /latest_version: 1.4.0/);
    });
});

test('curate: imported plugin origins feed analyze update guidance', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-curate-plugin-analyze-root');
        memoryFs.writeTree(root, {
            '.harness': {},
            '.claude': {
                'settings.json': JSON.stringify({
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true
                    }
                }, null, 2),
                plugins: {
                    cache: {
                        'claude-code-plugins': {
                            'frontend-design': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            version: '1.0.0'
                                        }, null, 2)
                                    }
                                }
                            }
                        }
                    }
                }
            },
            'plugin-research.json': JSON.stringify({
                plugin_origins: [{
                    plugin: 'frontend-design@claude-code-plugins',
                    hosts: ['claude'],
                    source_type: 'github',
                    repo: 'acme/frontend-design',
                    url: 'https://github.com/acme/frontend-design',
                    latest_version: '1.4.0',
                    confidence: 'llm-inferred'
                }]
            }, null, 2)
        });

        runCurate(root, {
            target: 'plugins',
            input: path.join(root, 'plugin-research.json')
        });

        const result = await runAnalyze(root, { category: 'plugins' });
        const entry = result.inventory.plugins.hosts.find((host) => host.llm === 'claude').plugins[0];
        assert.equal(entry.curatedOrigin.repo, 'acme/frontend-design');
        assert.equal(entry.latestVersion, '1.4.0');
        assert.equal(entry.updateAvailable, true);
    });
});

test('curate: later imports replace earlier entries with the same plugin and hosts', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-curate-plugin-merge-root');
        memoryFs.writeTree(root, {
            '.harness': {
                'plugin-origins.yaml': [
                    'plugin_origins:',
                    '  - plugin: frontend-design@claude-code-plugins',
                    '    hosts: [claude]',
                    '    source_type: github',
                    '    repo: old/repo',
                    '    latest_version: 1.0.0',
                    ''
                ].join('\n')
            },
            'plugin-research.yaml': [
                'plugin_origins:',
                '  - plugin: frontend-design@claude-code-plugins',
                '    hosts: [claude]',
                '    source_type: github',
                '    repo: acme/frontend-design',
                '    latest_version: 1.4.0',
                ''
            ].join('\n')
        });

        runCurate(root, {
            target: 'plugins',
            input: path.join(root, 'plugin-research.yaml')
        });

        const saved = readUtf8(path.join(root, '.harness', 'plugin-origins.yaml'));
        assert.doesNotMatch(saved, /old\/repo/);
        assert.match(saved, /acme\/frontend-design/);
        assert.match(saved, /latest_version: 1.4.0/);
    });
});
