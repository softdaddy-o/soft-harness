const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectPluginDrift, loadPlugins, syncPlugins } = require('../src/plugins');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { loadFresh, makeProjectTree, makeTempDir } = require('./helpers');

test('plugins: loadPlugins parses yaml', () => {
    const root = makeTempDir('soft-harness-plugins-');
    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: superpowers',
        '    llms: [claude]',
        '    install: echo install',
        '    uninstall: echo uninstall',
        ''
    ].join('\n'));

    const plugins = loadPlugins(root);
    assert.equal(plugins.length, 1);
    assert.equal(plugins[0].name, 'superpowers');
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

test('plugins: syncPlugins plans installs during dry-run', () => {
    const root = makeTempDir('soft-harness-plugins-sync-');
    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: superpowers',
        '    llms: [claude]',
        '    install: echo install',
        '    uninstall: echo uninstall',
        ''
    ].join('\n'));

    const result = syncPlugins(root, { plugins: [] }, { dryRun: true });
    assert.equal(result.actions.length, 1);
    assert.equal(result.actions[0].status, 'planned');
});

test('plugins: loadPlugins handles missing file and validates schema', () => {
    const root = makeTempDir('soft-harness-plugins-missing-');
    assert.deepEqual(loadPlugins(root), []);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), 'plugins: {}\n');
    assert.throws(() => loadPlugins(root), /plugins array/i);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: broken',
        '    llms: [claude]',
        '    install: echo install',
        ''
    ].join('\n'));
    assert.throws(() => loadPlugins(root), /name, install, and uninstall/i);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), [
        'plugins:',
        '  - name: invalid',
        '    llms: [bogus]',
        '    install: echo install',
        '    uninstall: echo uninstall',
        ''
    ].join('\n'));
    assert.throws(() => loadPlugins(root), /invalid llms/i);
});

test('plugins: syncPlugins runs install and uninstall commands and records next state', () => {
    const root = makeProjectTree('soft-harness-plugins-run-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers',
                '    version: 2.0.0',
                '    llms: [claude]',
                '    install: echo installed>install.txt',
                '    uninstall: echo unused>uninstall.txt',
                ''
            ].join('\n')
        }
    });

    const result = syncPlugins(root, {
        plugins: [{
            name: 'old-plugin',
            uninstall: `"${process.execPath}" -e "require('fs').writeFileSync('removed.txt','removed')"`,
            install_hash: 'old'
        }]
    }, {});

    assert.equal(result.actions.length, 2);
    assert.equal(result.actions.every((action) => action.status === 'ran'), true);
    assert.equal(result.state[0].version, '2.0.0');
    assert.equal(result.state[0].uninstall, 'echo unused>uninstall.txt');
    assert.match(readUtf8(path.join(root, 'install.txt')), /installed/i);
    assert.match(readUtf8(path.join(root, 'removed.txt')), /removed/i);
});

test('plugins: syncPlugins can skip uninstalls and surfaces command failures', () => {
    const root = makeProjectTree('soft-harness-plugins-fail-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers',
                '    llms: [claude]',
                "    install: 'node -e \"process.stderr.write(''boom'');process.exit(2)\"'",
                '    uninstall: echo uninstall',
                ''
            ].join('\n')
        }
    });

    assert.throws(() => syncPlugins(root, { plugins: [] }, {}), /install failed for superpowers: boom/i);

    writeUtf8(path.join(root, '.harness', 'plugins.yaml'), 'plugins: []\n');
    const skipped = syncPlugins(root, {
        plugins: [{
            name: 'legacy',
            uninstall: `"${process.execPath}" -e "process.exit(2)"`,
            install_hash: 'old'
        }]
    }, { noRunUninstalls: true });
    assert.equal(skipped.actions[0].status, 'planned');
});

test('plugins: detectPluginDrift reads plugin names from JSON and TOML manifests defensively', () => {
    const root = makeProjectTree('soft-harness-plugins-manifests-', {
        '.harness': {
            'plugins.yaml': 'plugins: []\n'
        },
        '.claude': {
            'settings.json': JSON.stringify({
                nested: {
                    plugins: [
                        'string-plugin',
                        { name: 'object-plugin' }
                    ]
                }
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
                '    install: echo install',
                '    uninstall: echo uninstall',
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
