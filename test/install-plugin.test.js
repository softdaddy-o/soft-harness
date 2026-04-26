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
                    version: '0.4.26'
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

test('install plugin: codex can mirror the user-level Claude-installed soft-harness plugin', () => {
    const sourceRoot = makeProjectTree('soft-harness-install-source-claude-cache-', {
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
        }
    });
    const targetRoot = makeProjectTree('soft-harness-install-target-claude-cache-', {});
    const claudeHome = makeProjectTree('soft-harness-install-home-claude-cache-', {
        '.claude': {
            plugins: {
                'installed_plugins.json': JSON.stringify({
                    version: 2,
                    plugins: {
                        'soft-harness@soft-harness': [{
                            version: '9.9.9',
                            installPath: '.claude/plugins/cache/softdaddy-o/soft-harness/9.9.9'
                        }]
                    }
                }, null, 2),
                cache: {
                    'softdaddy-o': {
                        'soft-harness': {
                            '9.9.9': {
                                '.claude-plugin': {
                                    'plugin.json': '{}'
                                },
                                '.codex-plugin': {
                                    'plugin.json': '{"version":"9.9.9"}'
                                },
                                skills: {
                                    analyze: {
                                        'SKILL.md': '# Analyze from Claude cache'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const result = installPlugin({
        source: 'claude',
        sourceRoot,
        target: targetRoot,
        claudeHome,
        host: 'codex'
    });

    assert.deepEqual(result.hosts, ['codex']);
    assert.equal(result.source, 'claude');
    assert.match(readUtf8(path.join(targetRoot, 'plugins', 'soft-harness', 'skills', 'analyze', 'SKILL.md')), /Claude cache/);

    const codexMarketplace = JSON.parse(readUtf8(path.join(targetRoot, '.agents', 'plugins', 'marketplace.json')));
    assert.ok(codexMarketplace.plugins.some((plugin) => plugin.name === 'soft-harness' && plugin.source.path === './plugins/soft-harness'));
});

test('install plugin: Claude cache scan skips malformed entries and prefers the newest version', () => {
    const sourceRoot = makeProjectTree('soft-harness-install-source-claude-scan-', {
        '.agents': {
            plugins: {
                'marketplace.json': JSON.stringify({
                    plugins: [{
                        name: 'soft-harness',
                        source: {
                            source: 'local',
                            path: './plugins/soft-harness'
                        }
                    }]
                }, null, 2)
            }
        }
    });
    const targetRoot = makeProjectTree('soft-harness-install-target-claude-scan-', {});
    const claudeHome = makeProjectTree('soft-harness-install-home-claude-scan-', {
        '.claude': {
            plugins: {
                cache: {
                    soft: {
                        broken: {
                            '.claude-plugin': {
                                'plugin.json': '{'
                            },
                            '.codex-plugin': {
                                'plugin.json': '{}'
                            }
                        },
                        older: {
                            '.claude-plugin': {
                                'plugin.json': '{"name":"soft-harness","version":"0.4.1"}'
                            },
                            '.codex-plugin': {
                                'plugin.json': '{}'
                            },
                            skills: {
                                analyze: {
                                    'SKILL.md': '# Analyze older'
                                }
                            }
                        },
                        newer: {
                            '.claude-plugin': {
                                'plugin.json': '{"name":"soft-harness","version":"0.4.10"}'
                            },
                            '.codex-plugin': {
                                'plugin.json': '{}'
                            },
                            skills: {
                                analyze: {
                                    'SKILL.md': '# Analyze newer'
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    installPlugin({
        source: 'claude',
        sourceRoot,
        target: targetRoot,
        claudeHome,
        host: 'codex'
    });

    assert.match(readUtf8(path.join(targetRoot, 'plugins', 'soft-harness', 'skills', 'analyze', 'SKILL.md')), /newer/);
});

test('install plugin: Claude reverse sync must use the Claude Code plugin system', () => {
    const sourceRoot = makeProjectTree('soft-harness-install-source-claude-reject-', {});
    const targetRoot = makeProjectTree('soft-harness-install-target-claude-reject-', {});

    assert.throws(() => installPlugin({
        source: 'claude',
        sourceRoot,
        target: targetRoot,
        host: 'claude'
    }), /Claude Code plugin system/);
});
