#!/usr/bin/env node

const path = require('node:path');
const { copyPath, ensureDir, exists, readJson, removePath, walkFiles, writeJson } = require('../src/fs-util');

function parseArgs(args) {
    const options = {
        host: 'both',
        source: 'release',
        claudeHome: null,
        sourceRoot: path.resolve(__dirname, '..'),
        target: process.cwd()
    };

    for (const arg of args || []) {
        if (arg.startsWith('--host=')) {
            options.host = arg.slice('--host='.length).trim() || 'both';
            continue;
        }
        if (arg.startsWith('--source=')) {
            options.source = arg.slice('--source='.length).trim() || 'release';
            continue;
        }
        if (arg === '--from-claude') {
            options.source = 'claude';
            continue;
        }
        if (arg.startsWith('--source-root=')) {
            options.sourceRoot = path.resolve(arg.slice('--source-root='.length).trim() || options.sourceRoot);
            continue;
        }
        if (arg.startsWith('--claude-home=')) {
            const claudeHome = arg.slice('--claude-home='.length).trim();
            options.claudeHome = claudeHome ? path.resolve(claudeHome) : null;
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
        hosts,
        source: normalizeSource(options.source)
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

function normalizeSource(value) {
    const text = String(value || 'release').trim().toLowerCase();
    if (text === 'release' || text === 'claude') {
        return text;
    }
    throw new Error(`invalid --source: ${value}`);
}

function installPlugin(options = {}) {
    const parsed = {
        source: normalizeSource(options.source || 'release'),
        sourceRoot: path.resolve(options.sourceRoot || path.resolve(__dirname, '..')),
        target: path.resolve(options.target || process.cwd()),
        claudeHome: options.claudeHome ? path.resolve(options.claudeHome) : resolveClaudeHome(),
        hosts: Array.isArray(options.hosts) ? options.hosts : normalizeHosts(options.host || 'both')
    };

    if (parsed.source === 'claude' && (parsed.hosts.length !== 1 || parsed.hosts[0] !== 'codex')) {
        throw new Error([
            'Claude Code plugin system must update Claude installs.',
            'Use Claude Code: /plugin marketplace update soft-harness, then /reload-plugins.',
            'Use --source=claude only with --host=codex to mirror Claude into Codex.'
        ].join(' '));
    }

    const pluginSourceDir = resolvePluginSourceDir(parsed);
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
        source: parsed.source,
        targetRoot: parsed.target,
        updated
    };
}

function resolvePluginSourceDir(options) {
    if (options.source === 'claude') {
        return findClaudeInstalledSoftHarnessRoot(options.target, options.claudeHome);
    }
    return path.join(options.sourceRoot, 'plugins', 'soft-harness');
}

function findClaudeInstalledSoftHarnessRoot(targetRoot, claudeHome) {
    const metadataRoots = getClaudeMetadataRoots(targetRoot, claudeHome);

    for (const metadataRoot of metadataRoots) {
        const installedCandidates = findClaudeInstalledPluginCandidates(metadataRoot);
        for (const candidate of installedCandidates) {
            if (isSoftHarnessPluginDir(candidate)) {
                return candidate;
            }
        }
    }

    for (const metadataRoot of metadataRoots) {
        const scanned = scanClaudePluginCacheForSoftHarness(metadataRoot);
        if (scanned) {
            return scanned;
        }
    }

    throw new Error([
        'Claude-installed soft-harness plugin not found.',
        'Update Claude with Claude Code first: /plugin marketplace update soft-harness, then /reload-plugins.',
        'Then rerun this installer with --host=codex --source=claude.'
    ].join(' '));
}

function getClaudeMetadataRoots(targetRoot, claudeHome) {
    const roots = [path.resolve(targetRoot)];
    if (claudeHome) {
        const resolvedClaudeHome = path.resolve(claudeHome);
        if (!roots.includes(resolvedClaudeHome)) {
            roots.push(resolvedClaudeHome);
        }
    }
    return roots;
}

function resolveClaudeHome() {
    const home = process.env.USERPROFILE || process.env.HOME;
    return home ? path.resolve(home) : null;
}

function findClaudeInstalledPluginCandidates(metadataRoot) {
    const installed = readJsonSafely(path.join(metadataRoot, '.claude', 'plugins', 'installed_plugins.json')) || {};
    const plugins = installed && installed.plugins && typeof installed.plugins === 'object' && !Array.isArray(installed.plugins)
        ? installed.plugins
        : {};
    const candidates = [];

    for (const [displayName, installs] of Object.entries(plugins)) {
        if (!isSoftHarnessPluginName(displayName)) {
            continue;
        }
        const entries = Array.isArray(installs) ? installs.slice().reverse() : [installs];
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object' || !entry.installPath) {
                continue;
            }
            candidates.push(resolveTargetPath(metadataRoot, entry.installPath));
        }
    }

    return candidates;
}

function scanClaudePluginCacheForSoftHarness(metadataRoot) {
    const cacheRoot = path.join(metadataRoot, '.claude', 'plugins', 'cache');
    if (!exists(cacheRoot)) {
        return null;
    }

    const manifests = walkFiles(cacheRoot, (relativePath) => {
        return relativePath.replace(/\\/g, '/').endsWith('/.claude-plugin/plugin.json');
    });

    const pluginDirs = [];
    for (const manifest of manifests) {
        const pluginDir = path.dirname(path.dirname(manifest.absolutePath));
        if (isSoftHarnessPluginDir(pluginDir)) {
            pluginDirs.push(pluginDir);
        }
    }

    return pluginDirs.sort(comparePluginDirsByVersion).at(0) || null;
}

function isSoftHarnessPluginDir(pluginDir) {
    const claudeManifestPath = path.join(pluginDir, '.claude-plugin', 'plugin.json');
    if (!exists(claudeManifestPath)
        || !exists(path.join(pluginDir, '.codex-plugin', 'plugin.json'))) {
        return false;
    }

    const claudeManifest = readJsonSafely(claudeManifestPath);
    if (!claudeManifest || typeof claudeManifest !== 'object' || Array.isArray(claudeManifest)) {
        return false;
    }

    if (claudeManifest.name) {
        return isSoftHarnessPluginName(claudeManifest.name);
    }
    return pluginDir.replace(/\\/g, '/').split('/').includes('soft-harness');
}

function comparePluginDirsByVersion(left, right) {
    const versionResult = compareVersionStrings(readPluginVersion(right), readPluginVersion(left));
    if (versionResult !== 0) {
        return versionResult;
    }
    return right.localeCompare(left);
}

function readPluginVersion(pluginDir) {
    const claudeManifest = readJsonSafely(path.join(pluginDir, '.claude-plugin', 'plugin.json')) || {};
    const codexManifest = readJsonSafely(path.join(pluginDir, '.codex-plugin', 'plugin.json')) || {};
    return claudeManifest.version || codexManifest.version || null;
}

function compareVersionStrings(left, right) {
    const leftParts = parseVersionParts(left);
    const rightParts = parseVersionParts(right);
    if (!leftParts && !rightParts) {
        return 0;
    }
    if (!leftParts) {
        return -1;
    }
    if (!rightParts) {
        return 1;
    }
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
        const leftPart = leftParts[index] || 0;
        const rightPart = rightParts[index] || 0;
        if (leftPart !== rightPart) {
            return leftPart - rightPart;
        }
    }
    return 0;
}

function parseVersionParts(value) {
    const match = String(value || '').trim().match(/^v?(\d+(?:\.\d+)*)/u);
    if (!match) {
        return null;
    }
    return match[1].split('.').map((part) => Number(part));
}

function isSoftHarnessPluginName(value) {
    const text = String(value || '').trim();
    if (text === 'soft-harness') {
        return true;
    }
    const separator = text.lastIndexOf('@');
    return separator > 0 && text.slice(0, separator) === 'soft-harness';
}

function resolveTargetPath(targetRoot, maybeRelativePath) {
    const text = String(maybeRelativePath || '').trim();
    if (path.isAbsolute(text)) {
        return path.resolve(text);
    }
    return path.resolve(targetRoot, text);
}

function readJsonSafely(filePath) {
    try {
        return readJson(filePath, null);
    } catch (error) {
        return null;
    }
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
            `source: ${result.source}`,
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
    normalizeSource,
    parseArgs
};
