const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectPluginDrift, loadPlugins, readInstalledPluginEntries, readInstalledPlugins, syncPlugins } = require('../src/plugins');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { createMemoryFs, loadFresh, makeProjectTree, makeTempDir } = require('./helpers');

test('plugins: loadPlugins parses yaml', () => {
    const root = makeTempDir('soft-harness-plugins-');
    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: superpowers',
        '    llms: [claude]',
        '    version: 1.0.0',
        '    source_type: github',
        '    url: https://github.com/example-org/superpowers',
        ''
    ].join('\n'));

    const plugins = loadPlugins(root);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'superpowers');
    assert.equal(plugins[0].version, '1.0.0');
});

test('plugins: detectPluginDrift reports installed plugins missing from plugins.yaml', () => {
    const root = makeTempDir('soft-harness-plugins-drift-');
    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), 'plugins: []\n');
    writeUtf8(path.join(root, '.claude', 'settings.json'), JSON.stringify({
        plugins: [{ name: 'manual-plugin' }]
    }, null, 2));

    const drift = detectPluginDrift(root);
    assert.ok(drift.some((entry) => entry.name === 'manual-plugin'));
});

test('plugins: syncPlugins tracks metadata changes during dry-run without shell execution', () => {
    const root = makeTempDir('soft-harness-plugins-sync-');
    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: superpowers',
        '    llms: [claude]',
        '    version: 1.0.0',
        ''
    ].join('\n'));

    const result = syncPlugins(root, { plugins: [] }, { dryRun: true });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, 'planned');
    assert.equal(result.actions[0].type, 'track');
});

test('plugins: loadPlugins handles missing file and validates schema', () => {
    const root = makeTempDir('soft-harness-plugins-missing-');
    assert.deepEqual(loadPlugins(root), []);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), 'plugins: {}\n');
    assert.throws(() => loadPlugins(root), /plugins array/i);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: broken',
        ''
    ].join('\n'));
    assert.throws(() => loadPlugins(root), /name and llms/i);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: invalid',
        '    llms: [bogus]',
        ''
    ].join('\n'));
    assert.throws(() => loadPlugins(root), /invalid llms/i);
});

test('plugins: syncPlugins records metadata-only state and removed entries without commands', () => {
    const root = makeProjectTree('soft-harness-plugins-run-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers',
                '    version: 2.0.0',
                '    llms: [claude]',
                '    source_type: github',
                '    url: https://github.com/example-org/superpowers',
                ''
            ].join('\n')
        }
    });

    const result = syncPlugins(root, {
        plugins: [{
            name: 'old-plugin',
            llms: ['claude'],
            version: '0.9.0'
        }]
    }, {});

    assert.equal(result.actions.length, 2);
    assert.equal(result.actions.every((action) => action.status === 'tracked'), true);
    assert.equal(result.state[0].version, '2.0.0');
    assert.equal(result.state[0].source_type, 'github');
    assert.equal(result.actions.some((action) => action.type === 'remove'), true);
});

test('plugins: syncPlugins can drop removed metadata entries without install or uninstall hooks', () => {
    const root = makeProjectTree('soft-harness-plugins-fail-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers',
                '    llms: [claude]',
                '    version: 1.0.0',
                ''
            ].join('\n')
        }
    });

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), 'plugins: []\n');
    const skipped = syncPlugins(root, {
        plugins: [{
            name: 'legacy',
            llms: ['claude'],
            version: '0.9.0'
        }]
    }, { dryRun: true });
    assert.equal(skipped.actions[0].status, 'planned');
    assert.equal(skipped.actions[0].type, 'remove');
});

test('plugins: detectPluginDrift reads top-level plugin names from JSON and TOML manifests defensively', () => {
    const root = makeProjectTree('soft-harness-plugins-manifests-', {
        '.harness': {
            'plugins.yaml': 'plugins: []\n'
        },
        '.claude': {
            'settings.json': JSON.stringify({
                plugins: [
                    'string-plugin',
                    { name: 'object-plugin' }
                ]
            }, null, 2)
        },
        '.codex': {
            'config.toml': [
                '[plugins.alpha]',
                'name = "alpha"',
                '[[plugins]]',
                'name = "beta"',
                ''
            ].join('\n')
        },
        '.gemini': {
            'settings.json': '{ invalid json'
        }
    });

    const drift = detectPluginDrift(root);
    const names = drift.map((entry) => entry.name).sort();
    assert.deepEqual(names, ['alpha', 'beta', 'object-plugin', 'string-plugin']);
});

test('plugins: detectPluginDrift respects desired llm assignments and array manifests', () => {
    const root = makeProjectTree('soft-harness-plugins-desired-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: shared-plugin',
                '    llms: [claude, codex]',
                ''
            ].join('\n')
        },
        '.claude': {
            'settings.json': JSON.stringify(['shared-plugin'], null, 2)
        },
        '.codex': {
            'config.toml': '[plugins.shared-plugin]\nname = "shared-plugin"\n'
        }
    });

    const drift = detectPluginDrift(root);
    assert.deepEqual(drift, []);
});

test('plugins: profiles without plugin manifests are ignored safely', () => {
    const profiles = require('../src/profiles');
    const originalListProfiles = profiles.listProfiles;
    const originalGetProfile = profiles.getProfile;
    profiles.listProfiles = () => ['custom'];
    profiles.getProfile = () => ({ plugins_manifest: '' });

    try {
        const freshPlugins = loadFresh('../src/plugins');
        assert.deepEqual(freshPlugins.detectPluginDrift(makeTempDir('soft-harness-plugins-nomanifest-')), []);
    } finally {
        profiles.listProfiles = originalListProfiles;
        profiles.getProfile = originalGetProfile;
        delete require.cache[require.resolve('../src/plugins')];
    }
});

test('plugins: virtual fs ignores permission settings and non-plugin names in manifests', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-plugins-vfs-root');
        memoryFs.writeTree(root, {
            '.harness': {
                'plugins.yaml': 'plugins: []\n'
            },
            '.claude': {
                'settings.json': JSON.stringify({
                    approval_policy: 'never',
                    sandbox_mode: 'workspace-write',
                    nested: {
                        profile: {
                            name: 'danger-full-access'
                        }
                    },
                    plugins: [
                        { name: 'real-json-plugin' }
                    ]
                }, null, 2)
            },
            '.codex': {
                'config.toml': [
                    'approval_policy = "never"',
                    '[sandbox_workspace_write]',
                    'name = "danger-full-access"',
                    '[plugins.real-toml-plugin]',
                    'name = "real-toml-plugin"',
                    ''
                ].join('\n')
            }
        });

        assert.deepEqual(readInstalledPlugins(root, 'claude'), ['real-json-plugin']);
        assert.deepEqual(readInstalledPlugins(root, 'codex'), ['real-toml-plugin']);

        const drift = detectPluginDrift(root);
        const names = drift.map((entry) => entry.name).sort();
        assert.deepEqual(names, ['real-json-plugin', 'real-toml-plugin']);
    });
});

test('plugins: virtual fs reads claude enabledPlugins and ignores gemini ui and mcp settings', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-plugins-vfs-host-shaped-root');
        memoryFs.writeTree(root, {
            '.claude': {
                'settings.json': JSON.stringify({
                    permissions: {
                        allow: ['WebSearch', 'Bash(git *)']
                    },
                    statusLine: {
                        command: '"node" "statusline.mjs"'
                    },
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true,
                        'skill-creator@claude-plugins-official': true,
                        'disabled-plugin@example': false
                    }
                }, null, 2)
            },
            '.gemini': {
                'settings.json': JSON.stringify({
                    ui: {
                        footer: {
                            items: ['workspace', 'git-branch', 'sandbox']
                        }
                    },
                    mcpServers: {
                        pencil: {
                            command: 'pencil.exe',
                            args: ['--app', 'desktop']
                        }
                    }
                }, null, 2)
            }
        });

        assert.deepEqual(readInstalledPlugins(root, 'claude'), [
            'frontend-design@claude-code-plugins',
            'skill-creator@claude-plugins-official'
        ]);
        assert.deepEqual(readInstalledPlugins(root, 'gemini'), []);
    });
});

test('plugins: virtual fs infers marketplace and github provenance from claude cache metadata', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-plugins-vfs-provenance-root');
        memoryFs.writeTree(root, {
            '.claude': {
                'settings.json': JSON.stringify({
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true,
                        'superpowers@claude-plugins-official': true
                    }
                }, null, 2),
                plugins: {
                    cache: {
                        'claude-code-plugins': {
                            'frontend-design': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'frontend-design',
                                            version: '1.0.0'
                                        }, null, 2)
                                    }
                                }
                            }
                        },
                        'claude-plugins-official': {
                            superpowers: {
                                '5.0.7': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'superpowers',
                                            version: '5.0.7'
                                        }, null, 2)
                                    },
                                    'package.json': JSON.stringify({
                                        name: 'superpowers',
                                        version: '5.0.7',
                                        repository: {
                                            type: 'git',
                                            url: 'git+https://github.com/softdaddy-o/superpowers.git'
                                        }
                                    }, null, 2)
                                }
                            }
                        }
                    }
                }
            }
        });

        const entries = readInstalledPluginEntries(root, 'claude');
        assert.deepEqual(entries.map((entry) => entry.displayName), [
            'frontend-design@claude-code-plugins',
            'superpowers@claude-plugins-official'
        ]);
        assert.deepEqual(entries.map((entry) => entry.version), ['1.0.0', '5.0.7']);
        assert.deepEqual(entries.map((entry) => entry.sourceType), ['marketplace', 'github']);
        assert.equal(entries[0].url, null);
        assert.equal(entries[0].evidence, 'enabledPlugins + cache metadata');
        assert.equal(entries[1].url, 'https://github.com/softdaddy-o/superpowers');
        assert.equal(entries[1].evidence, 'enabledPlugins + cache metadata');
    });
});

test('plugins: virtual fs enriches claude plugin entries from known marketplace github metadata', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-plugins-vfs-marketplace-origin-root');
        memoryFs.writeTree(root, {
            '.claude': {
                'settings.json': JSON.stringify({
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true,
                        'split-plugin@claude-plugins-official': true,
                        'superpowers@claude-plugins-official': true,
                        'ui-ux-pro-max@ui-ux-pro-max-skill': true
                    }
                }, null, 2),
                plugins: {
                    'known_marketplaces.json': JSON.stringify({
                        'claude-code-plugins': {
                            source: {
                                source: 'github',
                                repo: 'anthropics/claude-code'
                            }
                        },
                        'claude-plugins-official': {
                            source: {
                                source: 'github',
                                repo: 'anthropics/claude-plugins-official'
                            }
                        },
                        'ui-ux-pro-max-skill': {
                            source: {
                                source: 'github',
                                repo: 'nextlevelbuilder/ui-ux-pro-max-skill'
                            }
                        }
                    }, null, 2),
                    'installed_plugins.json': JSON.stringify({
                        version: 2,
                        plugins: {
                            'frontend-design@claude-code-plugins': [{
                                version: '1.0.0',
                                gitCommitSha: 'abc123'
                            }],
                            'split-plugin@claude-plugins-official': [{
                                version: '1.0.0',
                                gitCommitSha: 'split123'
                            }],
                            'superpowers@claude-plugins-official': [{
                                version: '5.0.7',
                                gitCommitSha: 'def456'
                            }],
                            'ui-ux-pro-max@ui-ux-pro-max-skill': [{
                                version: '2.0.1',
                                gitCommitSha: 'ghi789'
                            }]
                        }
                    }, null, 2),
                    marketplaces: {
                        'claude-code-plugins': {
                            '.claude-plugin': {
                                'marketplace.json': JSON.stringify({
                                    plugins: [{
                                        name: 'frontend-design',
                                        version: '1.0.0',
                                        source: './plugins/frontend-design'
                                    }]
                                }, null, 2)
                            }
                        },
                        'claude-plugins-official': {
                            '.claude-plugin': {
                                'marketplace.json': JSON.stringify({
                                    plugins: [{
                                        name: 'split-plugin',
                                        version: '1.0.0',
                                        source: './plugins/split-plugin'
                                    }, {
                                        name: 'superpowers',
                                        version: '5.0.7',
                                        source: {
                                            source: 'url',
                                            url: 'https://github.com/obra/superpowers.git'
                                        }
                                    }]
                                }, null, 2)
                            }
                        },
                        'ui-ux-pro-max-skill': {
                            '.claude-plugin': {
                                'marketplace.json': JSON.stringify({
                                    plugins: [{
                                        name: 'ui-ux-pro-max',
                                        version: '2.0.1',
                                        source: './'
                                    }]
                                }, null, 2)
                            },
                            '.git': {
                                config: [
                                    '[remote "origin"]',
                                    '\turl = https://github.com/nextlevelbuilder/ui-ux-pro-max-skill.git',
                                    ''
                                ].join('\n')
                            }
                        }
                    },
                    cache: {
                        'claude-code-plugins': {
                            'frontend-design': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'frontend-design',
                                            version: '1.0.0'
                                        }, null, 2)
                                    }
                                }
                            }
                        },
                        'claude-plugins-official': {
                            'split-plugin': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'split-plugin',
                                            version: '1.0.0'
                                        }, null, 2)
                                    },
                                    'package.json': JSON.stringify({
                                        name: 'split-plugin',
                                        version: '1.0.0',
                                        repository: {
                                            type: 'git',
                                            url: 'git+https://github.com/acme/split-plugin.git'
                                        }
                                    }, null, 2)
                                }
                            },
                            superpowers: {
                                '5.0.7': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'superpowers',
                                            version: '5.0.7'
                                        }, null, 2)
                                    }
                                }
                            }
                        },
                        'ui-ux-pro-max-skill': {
                            'ui-ux-pro-max': {
                                '2.0.1': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'ui-ux-pro-max',
                                            version: '2.0.1'
                                        }, null, 2)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const entries = readInstalledPluginEntries(root, 'claude');
        const frontend = entries.find((entry) => entry.displayName === 'frontend-design@claude-code-plugins');
        const splitPlugin = entries.find((entry) => entry.displayName === 'split-plugin@claude-plugins-official');
        const superpowers = entries.find((entry) => entry.displayName === 'superpowers@claude-plugins-official');
        const uiUx = entries.find((entry) => entry.displayName === 'ui-ux-pro-max@ui-ux-pro-max-skill');

        assert.equal(frontend.sourceType, 'github');
        assert.equal(frontend.repo, 'anthropics/claude-code');
        assert.equal(frontend.url, 'https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design');
        assert.equal(frontend.sourcePath, 'plugins/frontend-design');
        assert.equal(frontend.gitCommitSha, 'abc123');
        assert.match(frontend.evidence, /known_marketplaces/);

        assert.equal(splitPlugin.sourceType, 'github');
        assert.equal(splitPlugin.repo, 'acme/split-plugin');
        assert.equal(splitPlugin.url, 'https://github.com/acme/split-plugin');
        assert.equal(splitPlugin.sourcePath, null);
        assert.equal(splitPlugin.gitCommitSha, 'split123');

        assert.equal(superpowers.sourceType, 'github');
        assert.equal(superpowers.repo, 'obra/superpowers');
        assert.equal(superpowers.url, 'https://github.com/obra/superpowers');
        assert.equal(superpowers.gitCommitSha, 'def456');

        assert.equal(uiUx.sourceType, 'github');
        assert.equal(uiUx.repo, 'nextlevelbuilder/ui-ux-pro-max-skill');
        assert.equal(uiUx.url, 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill');
        assert.equal(uiUx.sourcePath, null);
        assert.equal(uiUx.gitCommitSha, 'ghi789');
    });
});

test('plugins: readInstalledPluginEntries keeps install paths from installed_plugins metadata', () => {
    const root = makeProjectTree('soft-harness-plugins-install-path-', {
        '.claude': {
            'settings.json': JSON.stringify({
                enabledPlugins: {
                    'superpowers@claude-plugins-official': true
                }
            }, null, 2),
            plugins: {
                'installed_plugins.json': JSON.stringify({
                    version: 2,
                    plugins: {
                        'superpowers@claude-plugins-official': [{
                            version: '5.0.7',
                            installPath: '.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7',
                            gitCommitSha: 'def456'
                        }]
                    }
                }, null, 2),
                cache: {
                    'claude-plugins-official': {
                        superpowers: {
                            '5.0.7': {
                                '.claude-plugin': {
                                    'plugin.json': JSON.stringify({
                                        name: 'superpowers',
                                        version: '5.0.7'
                                    }, null, 2)
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    const entries = readInstalledPluginEntries(root, 'claude');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].displayName, 'superpowers@claude-plugins-official');
    assert.equal(entries[0].installPath, '.claude/plugins/cache/claude-plugins-official/superpowers/5.0.7');
});
