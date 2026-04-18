const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exportSettings, mergeHarnessSettings } = require('../src/settings');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('settings: mergeHarnessSettings combines portable and llm-specific MCP definitions', () => {
    const root = makeTempDir('soft-harness-settings-merge-');
    writeUtf8(path.join(root, '.harness', 'settings', 'portable.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  shared:',
        '    command: node',
        '    args: [shared.js]',
        '    enabled_for: [claude, codex]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'settings', 'llm', 'claude.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  claude-only:',
        '    command: node',
        '    args: [claude.js]',
        '    enabled_for: [claude]',
        ''
    ].join('\n'));

    const claude = mergeHarnessSettings(root, 'claude');
    const codex = mergeHarnessSettings(root, 'codex');

    assert.deepEqual(Object.keys(claude.mcp_servers).sort(), ['claude-only', 'shared']);
    assert.deepEqual(Object.keys(codex.mcp_servers).sort(), ['shared']);
});

test('settings: exportSettings preserves unrelated JSON keys and writes managed MCP servers', () => {
    const root = makeTempDir('soft-harness-settings-json-');
    writeUtf8(path.join(root, '.harness', 'settings', 'portable.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  shared:',
        '    transport: stdio',
        '    command: node',
        '    args: [shared.js]',
        '    enabled_for: [claude, gemini]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.claude', 'settings.json'), JSON.stringify({
        approval_policy: 'never',
        theme: 'dark',
        mcpServers: {
            stale: {
                command: 'old'
            }
        }
    }, null, 2));

    const result = exportSettings(root, {});
    const claudeSettings = JSON.parse(readUtf8(path.join(root, '.claude', 'settings.json')));
    const geminiSettings = JSON.parse(readUtf8(path.join(root, '.gemini', 'settings.json')));

    assert.equal(result.exported.length, 2);
    assert.equal(claudeSettings.approval_policy, 'never');
    assert.equal(claudeSettings.theme, 'dark');
    assert.deepEqual(Object.keys(claudeSettings.mcpServers), ['shared']);
    assert.deepEqual(Object.keys(geminiSettings.mcpServers), ['shared']);
});

test('settings: exportSettings preserves unrelated TOML content and replaces managed mcp_servers sections', () => {
    const root = makeTempDir('soft-harness-settings-toml-');
    writeUtf8(path.join(root, '.harness', 'settings', 'portable.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  shared:',
        '    transport: stdio',
        '    command: node',
        '    args: [shared.js]',
        '    enabled_for: [codex]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.codex', 'config.toml'), [
        'approval_policy = "never"',
        '',
        '[mcp_servers.stale]',
        'command = "old"',
        '',
        '[ui]',
        'theme = "dark"',
        ''
    ].join('\n'));

    exportSettings(root, {});
    const config = readUtf8(path.join(root, '.codex', 'config.toml'));

    assert.match(config, /approval_policy = "never"/);
    assert.match(config, /\[ui\]/);
    assert.match(config, /theme = "dark"/);
    assert.match(config, /\[mcp_servers\.shared\]/);
    assert.doesNotMatch(config, /\[mcp_servers\.stale\]/);
});
