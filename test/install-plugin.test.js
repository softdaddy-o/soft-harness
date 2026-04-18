const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { installPlugin } = require('../scripts/install-plugin');
const { makeProjectTree } = require('./helpers');

test('install plugin: installs shared plugin files and merges both marketplaces', () => {
    const sourceRoot = makeProjectTree('soft-harness-install-source-', {
        '.claude-plugin': {
            'marketplace.json': JSON.stringify({
                name: 'soft-harness',
                owner: {
                    name: 'softdaddy-o',
                    url: 'https://github.com/softdaddy-o'
                },
                plugins: [{
                    name: 'soft-harness',
                    source: './plugins/soft-harness',
                    description: 'Analyze and organize live host state with LLM-guided workflows.',
                    version: '0.4.23'
                }]
            }, null, 2)
        },
        '.agents': {
            plugins: {
                'marketplace.json': JSON.stringify({
                    name: 'soft-harness-local',
                    interface: {
                        displayName: 'Soft Harness Local'
                    },
                    plugins: [{
                        name: 'soft-harness',
                        source: {
                            source: 'local',
                            path: './plugins/soft-harness'
                        },
                        policy: {
                            installation: 'AVAILABLE',
                            authentication: 'ON_INSTALL'
                        },
                        category: 'Productivity'
                    }]
                }, null, 2)
            }
        },
        plugins: {
            'soft-harness': {
                '.codex-plugin': {
                    'plugin.json': '{}'
                },
                '.claude-plugin': {
                    'plugin.json': '{}'
                },
                skills: {
                    analyze: {
                        'SKILL.md': '# Analyze'
                    }
                }
            }
        }
    });
    const targetRoot = makeProjectTree('soft-harness-install-target-', {
        '.claude-plugin': {
            'marketplace.json': JSON.stringify({
                name: 'my-claude-marketplace',
                owner: {
                    name: 'local-owner'
                },
                plugins: [{
                    name: 'existing-claude-plugin',
                    source: './plugins/existing-claude-plugin'
                }]
            }, null, 2)
        },
        '.agents': {
            plugins: {
                'marketplace.json': JSON.stringify({
                    name: 'my-codex-marketplace',
                    interface: {
                        displayName: 'My Codex Marketplace'
                    },
                    plugins: [{
                        name: 'existing-codex-plugin',
                        source: {
                            source: 'local',
                            path: './plugins/existing-codex-plugin'
                        }
                    }]
                }, null, 2)
            }
        }
    });

    const result = installPlugin({
        sourceRoot,
        target: targetRoot,
        host: 'both'
    });

    assert.deepEqual(result.hosts, ['claude', 'codex']);
    assert.match(readUtf8(path.join(targetRoot, 'plugins', 'soft-harness', 'skills', 'analyze', 'SKILL.md')), /Analyze/);

    const claudeMarketplace = JSON.parse(readUtf8(path.join(targetRoot, '.claude-plugin', 'marketplace.json')));
    assert.equal(claudeMarketplace.name, 'my-claude-marketplace');
    assert.equal(claudeMarketplace.plugins.length, 2);
    assert.ok(claudeMarketplace.plugins.some((plugin) => plugin.name === 'existing-claude-plugin'));
    assert.ok(claudeMarketplace.plugins.some((plugin) => plugin.name === 'soft-harness' && plugin.source === './plugins/soft-harness'));

    const codexMarketplace = JSON.parse(readUtf8(path.join(targetRoot, '.agents', 'plugins', 'marketplace.json')));
    assert.equal(codexMarketplace.name, 'my-codex-marketplace');
    assert.equal(codexMarketplace.plugins.length, 2);
    assert.ok(codexMarketplace.plugins.some((plugin) => plugin.name === 'existing-codex-plugin'));
    assert.ok(codexMarketplace.plugins.some((plugin) => plugin.name === 'soft-harness' && plugin.source && plugin.source.path === './plugins/soft-harness'));
});

test('install plugin: host filter updates only requested marketplace', () => {
    const sourceRoot = makeProjectTree('soft-harness-install-source-codex-', {
        '.agents': {
            plugins: {
                'marketplace.json': JSON.stringify({
                    name: 'soft-harness-local',
                    interface: {
                        displayName: 'Soft Harness Local'
                    },
                    plugins: [{
                        name: 'soft-harness',
                        source: {
                            source: 'local',
                            path: './plugins/soft-harness'
                        }
                    }]
                }, null, 2)
            }
        },
        plugins: {
            'soft-harness': {
                '.codex-plugin': {
                    'plugin.json': '{}'
                }
            }
        }
    });
    const targetRoot = makeProjectTree('soft-harness-install-target-codex-', {});
    writeUtf8(path.join(targetRoot, '.claude-plugin', 'marketplace.json'), JSON.stringify({
        name: 'leave-me-alone',
        plugins: []
    }, null, 2));

    installPlugin({
        sourceRoot,
        target: targetRoot,
        host: 'codex'
    });

    assert.match(readUtf8(path.join(targetRoot, '.claude-plugin', 'marketplace.json')), /leave-me-alone/);
    const codexMarketplace = JSON.parse(readUtf8(path.join(targetRoot, '.agents', 'plugins', 'marketplace.json')));
    assert.ok(codexMarketplace.plugins.some((plugin) => plugin.name === 'soft-harness'));
});
