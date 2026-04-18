#!/usr/bin/env node

const path = require('node:path');
const { copyPath, ensureDir, exists, readJson, removePath, writeJson } = require('../src/fs-util');

function parseArgs(args) {
    const options = {
        host: 'both',
        sourceRoot: path.resolve(__dirname, '..'),
        target: process.cwd()
    };

    for (const arg of args || []) {
        if (arg.startsWith('--host=')) {
            options.host = arg.slice('--host='.length).trim() || 'both';
            continue;
        }
        if (arg.startsWith('--source-root=')) {
            options.sourceRoot = path.resolve(arg.slice('--source-root='.length).trim() || options.sourceRoot);
            continue;
        }
        if (arg.startsWith('--target=')) {
            options.target = path.resolve(arg.slice('--target='.length).trim() || options.target);
            continue;
        }
    }

    const hosts = normalizeHosts(options.host);
    return {
        ...options,
        hosts
    };
}

function normalizeHosts(value) {
    const text = String(value || 'both').trim().toLowerCase();
    if (text === 'both') {
        return ['claude', 'codex'];
    }
    if (text === 'claude' || text === 'codex') {
        return [text];
    }
    throw new Error(`invalid --host: ${value}`);
}

function installPlugin(options = {}) {
    const parsed = {
        sourceRoot: path.resolve(options.sourceRoot || path.resolve(__dirname, '..')),
        target: path.resolve(options.target || process.cwd()),
        hosts: Array.isArray(options.hosts) ? options.hosts : normalizeHosts(options.host || 'both')
    };

    const pluginSourceDir = path.join(parsed.sourceRoot, 'plugins', 'soft-harness');
    if (!exists(pluginSourceDir)) {
        throw new Error(`soft-harness plugin source not found: ${pluginSourceDir}`);
    }

    const pluginTargetDir = path.join(parsed.target, 'plugins', 'soft-harness');
    removePath(pluginTargetDir);
    ensureDir(path.join(parsed.target, 'plugins'));
    copyPath(pluginSourceDir, pluginTargetDir);

    const updated = [
        toProjectRelative(parsed.target, pluginTargetDir)
    ];

    if (parsed.hosts.includes('claude')) {
        updated.push(installClaudeMarketplace(parsed.sourceRoot, parsed.target));
    }
    if (parsed.hosts.includes('codex')) {
        updated.push(installCodexMarketplace(parsed.sourceRoot, parsed.target));
    }

    return {
        hosts: parsed.hosts,
        pluginDir: toProjectRelative(parsed.target, pluginTargetDir),
        targetRoot: parsed.target,
        updated
    };
}

function installClaudeMarketplace(sourceRoot, targetRoot) {
    const sourcePath = path.join(sourceRoot, '.claude-plugin', 'marketplace.json');
    const targetPath = path.join(targetRoot, '.claude-plugin', 'marketplace.json');
    const sourceMarketplace = readJson(sourcePath, {});
    const current = readJson(targetPath, {});
    const pluginEntry = cloneJson(findNamedPlugin(sourceMarketplace.plugins, 'soft-harness') || buildClaudePluginFallback());

    pluginEntry.source = './plugins/soft-harness';

    const next = {
        ...current,
        name: current.name || sourceMarketplace.name || 'soft-harness-local',
        owner: current.owner || sourceMarketplace.owner || {
            name: 'softdaddy-o',
            url: 'https://github.com/softdaddy-o'
        },
        plugins: upsertNamedPlugin(current.plugins, pluginEntry)
    };

    writeJson(targetPath, next);
    return toProjectRelative(targetRoot, targetPath);
}

function installCodexMarketplace(sourceRoot, targetRoot) {
    const sourcePath = path.join(sourceRoot, '.agents', 'plugins', 'marketplace.json');
    const targetPath = path.join(targetRoot, '.agents', 'plugins', 'marketplace.json');
    const sourceMarketplace = readJson(sourcePath, {});
    const current = readJson(targetPath, {});
    const pluginEntry = cloneJson(findNamedPlugin(sourceMarketplace.plugins, 'soft-harness') || buildCodexPluginFallback());

    pluginEntry.source = {
        source: 'local',
        path: './plugins/soft-harness'
    };

    const next = {
        ...current,
        name: current.name || sourceMarketplace.name || 'soft-harness-local',
        interface: current.interface || sourceMarketplace.interface || {
            displayName: 'Soft Harness Local'
        },
        plugins: upsertNamedPlugin(current.plugins, pluginEntry)
    };

    writeJson(targetPath, next);
    return toProjectRelative(targetRoot, targetPath);
}

function upsertNamedPlugin(plugins, pluginEntry) {
    const items = Array.isArray(plugins) ? plugins.map((plugin) => cloneJson(plugin)) : [];
    const nextEntry = cloneJson(pluginEntry);
    const index = items.findIndex((plugin) => plugin && plugin.name === nextEntry.name);
    if (index >= 0) {
        items[index] = {
            ...items[index],
            ...nextEntry
        };
    } else {
        items.push(nextEntry);
    }
    return items;
}

function findNamedPlugin(plugins, name) {
    return Array.isArray(plugins)
        ? plugins.find((plugin) => plugin && plugin.name === name) || null
        : null;
}

function buildClaudePluginFallback() {
    return {
        name: 'soft-harness',
        source: './plugins/soft-harness',
        description: 'See your messy Claude Code or Codex setup clearly, then clean it up with guided organize flows.',
        version: null,
        author: {
            name: 'softdaddy-o'
        }
    };
}

function buildCodexPluginFallback() {
    return {
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
    };
}

function cloneJson(value) {
    return value ? JSON.parse(JSON.stringify(value)) : {};
}

function toProjectRelative(rootDir, filePath) {
    return path.relative(rootDir, filePath).split(path.sep).join('/');
}

function main() {
    try {
        const result = installPlugin(parseArgs(process.argv.slice(2)));
        process.stdout.write([
            'soft-harness installed',
            `target: ${result.targetRoot}`,
            `hosts: ${result.hosts.join(', ')}`,
            `plugin: ${result.pluginDir}`,
            `updated: ${result.updated.join(', ')}`
        ].join('\n'));
        process.stdout.write('\n');
    } catch (error) {
        process.stderr.write(`install failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    installPlugin,
    normalizeHosts,
    parseArgs
};
