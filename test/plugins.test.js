const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectPluginDrift, loadPlugins, syncPlugins } = require('../src/plugins');
const { writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

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
