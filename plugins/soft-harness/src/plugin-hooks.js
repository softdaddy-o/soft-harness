const path = require('node:path');

const { exists, readUtf8, removePath, writeJson, writeUtf8 } = require('./fs-util');

const SUPPORTED_PLUGIN = 'superpowers';
const SUPPORTED_SESSION_START = /^"?\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run-hook\.cmd"?\s+session-start$/u;

function prepareCodexPluginHooks(pluginRoot, options = {}) {
    const manifestResult = stripManifestHooks(pluginRoot);
    const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
    if (!exists(hooksPath)) return manifestResult;

    let parsed;
    try {
        parsed = JSON.parse(readUtf8(hooksPath));
    } catch {
        removePath(hooksPath);
        return {
            status: 'invalid',
            hooks: [...manifestResult.hooks, { event: 'hooks.json', reason: 'invalid JSON removed' }]
        };
    }

    const migrated = [];
    const rejected = [];
    for (const [event, groups] of Object.entries(parsed.hooks || {})) {
        for (const group of Array.isArray(groups) ? groups : []) {
            for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
                if (canMigrateHandler(options.pluginName, event, handler)) {
                    migrated.push({ matcher: group.matcher || null, async: Boolean(handler.async) });
                } else {
                    rejected.push({ event, reason: describeUnsupportedHandler(options.pluginName, handler) });
                }
            }
        }
    }

    // A copied Claude hook must never stay enabled in Codex. Replace only the
    // verified Superpowers launcher and disable every other source hook.
    removePath(hooksPath);
    if (migrated.length === 0) {
        return {
            status: rejected.length > 0 || manifestResult.hooks.length > 0 ? 'unsupported' : manifestResult.status,
            hooks: [...manifestResult.hooks, ...rejected]
        };
    }

    const generated = migrated.map((entry, index) => buildSessionStartGroup(pluginRoot, entry, index));
    writeJson(hooksPath, { hooks: { SessionStart: generated } });
    return {
        status: rejected.length > 0 || manifestResult.hooks.length > 0 ? 'partial' : 'migrated',
        hooks: [...manifestResult.hooks, ...rejected, ...migrated.map(() => ({ event: 'SessionStart', reason: 'migrated' }))]
    };
}

function stripManifestHooks(pluginRoot) {
    const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');
    if (!exists(manifestPath)) return { status: 'none', hooks: [] };

    let manifest;
    try {
        manifest = JSON.parse(readUtf8(manifestPath));
    } catch {
        return { status: 'invalid', hooks: [{ event: 'manifest', reason: 'invalid plugin manifest' }] };
    }

    if (!Object.prototype.hasOwnProperty.call(manifest, 'hooks')) {
        return { status: 'none', hooks: [] };
    }

    delete manifest.hooks;
    writeJson(manifestPath, manifest);
    return { status: 'partial', hooks: [{ event: 'manifest', reason: 'manifest hook configuration removed' }] };
}

function canMigrateHandler(pluginName, event, handler) {
    return pluginName === SUPPORTED_PLUGIN
        && event === 'SessionStart'
        && handler && handler.type === 'command'
        && typeof handler.command === 'string'
        && SUPPORTED_SESSION_START.test(handler.command.trim());
}

function describeUnsupportedHandler(pluginName, handler) {
    if (pluginName !== SUPPORTED_PLUGIN) return 'plugin is not on the hook migration allowlist';
    if (!handler || handler.type !== 'command') return 'unsupported hook handler type';
    return 'unsupported Claude hook command';
}

function buildSessionStartGroup(pluginRoot, entry, index) {
    const adapterName = `soft-harness-codex-session-start-${index}`;
    const hooksDir = path.join(pluginRoot, 'hooks');
    writeUtf8(path.join(hooksDir, `${adapterName}.cmd`), [
        '@echo off',
        'set "CLAUDE_PLUGIN_ROOT="',
        'call "%~dp0run-hook.cmd" session-start',
        'exit /b %ERRORLEVEL%',
        ''
    ].join('\r\n'));
    writeUtf8(path.join(hooksDir, `${adapterName}.sh`), [
        '#!/usr/bin/env bash',
        'set -euo pipefail',
        'unset CLAUDE_PLUGIN_ROOT',
        'exec bash "$(dirname "$0")/run-hook.cmd" session-start',
        ''
    ].join('\n'));

    return {
        ...(entry.matcher ? { matcher: entry.matcher } : {}),
        hooks: [{
            type: 'command',
            command: `bash "${'${PLUGIN_ROOT}'}/hooks/${adapterName}.sh"`,
            commandWindows: `"${'${PLUGIN_ROOT}'}/hooks/${adapterName}.cmd"`,
            async: entry.async
        }]
    };
}

module.exports = {
    prepareCodexPluginHooks
};
