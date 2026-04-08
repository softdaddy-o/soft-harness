const fs = require('fs');
const os = require('os');
const path = require('path');
const { ensureDir, exists, toPosixRelative, writeJson } = require('./fs-util');

function discoverState(projectRoot, options) {
    const userHome = options.userHome || os.homedir();
    const discoveredAt = new Date().toISOString();
    const assets = [];

    discoverProjectAssets(projectRoot, assets);
    discoverAccountAssets(userHome, assets);

    return {
        discoveredAt,
        projectRoot,
        userHome,
        assets
    };
}

function discoverAccountState(options) {
    const userHome = (options && options.userHome) || os.homedir();
    const discoveredAt = new Date().toISOString();
    const assets = [];

    discoverAccountAssets(userHome, assets);

    return {
        discoveredAt,
        projectRoot: null,
        userHome,
        assets
    };
}

function discoverProjectAssets(projectRoot, assets) {
    const projectChecks = [
        { path: path.join(projectRoot, 'AGENTS.md'), type: 'instruction', target: 'codex', scope: 'project' },
        { path: path.join(projectRoot, 'CLAUDE.md'), type: 'instruction', target: 'claude', scope: 'project' },
        { path: path.join(projectRoot, '.mcp.json'), type: 'mcp-config', target: 'both', scope: 'project' },
        { path: path.join(projectRoot, '.claude', 'settings.json'), type: 'settings', target: 'claude', scope: 'project' }
    ];

    for (const entry of projectChecks) {
        if (exists(entry.path)) {
            assets.push(describeAsset(projectRoot, entry.path, entry));
        }
    }

    discoverDirectoryEntries(projectRoot, path.join(projectRoot, '.codex', 'skills'), assets, (fullPath, name) => {
        const skillFile = path.join(fullPath, 'SKILL.md');
        return fs.statSync(fullPath).isDirectory() && exists(skillFile)
            ? describeAsset(projectRoot, skillFile, { type: 'skill', target: 'codex', scope: 'project', idHint: name })
            : null;
    });

    discoverDirectoryEntries(projectRoot, path.join(projectRoot, '.claude', 'agents'), assets, (fullPath, name) => {
        if (fs.statSync(fullPath).isFile() && fullPath.endsWith('.md')) {
            return describeAsset(projectRoot, fullPath, {
                type: 'agent',
                target: 'claude',
                scope: 'project',
                idHint: name.replace(/\.md$/i, '')
            });
        }
        return null;
    });
}

function discoverAccountAssets(userHome, assets) {
    const accountChecks = [
        { path: path.join(userHome, '.claude', 'CLAUDE.md'), type: 'instruction', target: 'claude', scope: 'account' },
        { path: path.join(userHome, '.claude', 'settings.json'), type: 'settings', target: 'claude', scope: 'account' }
    ];

    for (const entry of accountChecks) {
        if (exists(entry.path)) {
            assets.push(describeAsset(userHome, entry.path, entry));
        }
    }

    discoverDirectoryEntries(userHome, path.join(userHome, '.agents', 'skills'), assets, (fullPath, name) => {
        const skillFile = path.join(fullPath, 'SKILL.md');
        return fs.statSync(fullPath).isDirectory() && exists(skillFile)
            ? describeAsset(userHome, skillFile, { type: 'skill', target: 'codex', scope: 'account', idHint: name })
            : null;
    });

    discoverDirectoryEntries(userHome, path.join(userHome, '.claude', 'agents'), assets, (fullPath, name) => {
        if (fs.statSync(fullPath).isFile() && fullPath.endsWith('.md')) {
            return describeAsset(userHome, fullPath, {
                type: 'agent',
                target: 'claude',
                scope: 'account',
                idHint: name.replace(/\.md$/i, '')
            });
        }
        return null;
    });

    discoverPluginCache(userHome, assets);
}

function discoverDirectoryEntries(baseRoot, directoryPath, assets, mapper, maxDepth) {
    if (!exists(directoryPath)) {
        return;
    }

    walkDirectory(directoryPath, 0, maxDepth || 1, (fullPath, name) => {
        const mapped = mapper(fullPath, name);
        if (mapped) {
            assets.push(mapped);
        }
    });
}

function walkDirectory(directoryPath, depth, maxDepth, visitor) {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(directoryPath, entry.name);
        visitor(fullPath, entry.name);
        if (entry.isDirectory() && depth + 1 < maxDepth) {
            walkDirectory(fullPath, depth + 1, maxDepth, visitor);
        }
    }
}

function discoverPluginCache(userHome, assets) {
    const cacheRoot = path.join(userHome, '.claude', 'plugins', 'cache');
    if (!exists(cacheRoot)) {
        return;
    }

    const vendorEntries = fs.readdirSync(cacheRoot, { withFileTypes: true });
    for (const vendorEntry of vendorEntries) {
        if (!vendorEntry.isDirectory()) {
            continue;
        }

        const vendorPath = path.join(cacheRoot, vendorEntry.name);
        if (isPluginRoot(vendorPath)) {
            assets.push(describeAsset(userHome, vendorPath, {
                type: 'plugin',
                target: 'claude',
                scope: 'account',
                idHint: vendorEntry.name
            }));
            continue;
        }

        const pluginEntries = fs.readdirSync(vendorPath, { withFileTypes: true });
        for (const pluginEntry of pluginEntries) {
            if (!pluginEntry.isDirectory()) {
                continue;
            }

            const pluginPath = path.join(vendorPath, pluginEntry.name);
            if (!isPluginRoot(pluginPath)) {
                continue;
            }
            assets.push(describeAsset(userHome, pluginPath, {
                type: 'plugin',
                target: 'claude',
                scope: 'account',
                idHint: pluginEntry.name
            }));
        }
    }
}

function isPluginRoot(directoryPath) {
    const markers = ['.claude-plugin', '.codex', 'skills', 'README.md', 'package.json'];
    return markers.some((marker) => exists(path.join(directoryPath, marker)));
}

function describeAsset(baseRoot, fullPath, meta) {
    return {
        idHint: meta.idHint || null,
        type: meta.type,
        target: meta.target,
        scope: meta.scope,
        classification: classifyAsset(meta.type, meta.scope, fullPath),
        path: fullPath,
        relativePath: toPosixRelative(baseRoot, fullPath)
    };
}

function classifyAsset(type, scope, fullPath) {
    const normalized = String(fullPath).replace(/\\/g, '/').toLowerCase();

    if (normalized.includes('/.claude/plugins/cache/') || normalized.includes('/.agents/skills/') || normalized.includes('/.codex/skills/')) {
        return 'vendor-cache';
    }

    if (normalized.includes('/temp_git_')) {
        return 'transient';
    }

    if (type === 'instruction' || type === 'settings' || type === 'mcp-config') {
        return 'primary';
    }

    if (scope === 'project') {
        return 'project-capability';
    }

    return 'account-capability';
}

function persistDiscovery(rootDir, discovery) {
    return persistDiscoveryAtHarnessRoot(path.join(rootDir, 'harness'), discovery);
}

function persistDiscoveryAtHarnessRoot(harnessRoot, discovery) {
    const discoveryDir = path.join(harnessRoot, 'state', 'discovered');
    ensureDir(discoveryDir);
    const latestPath = path.join(discoveryDir, 'latest.json');
    const timestampPath = path.join(discoveryDir, `${discovery.discoveredAt.replace(/[:.]/g, '-')}.json`);
    writeJson(latestPath, discovery);
    writeJson(timestampPath, discovery);

    return {
        latestPath,
        timestampPath
    };
}

module.exports = {
    discoverAccountState,
    discoverState,
    persistDiscovery,
    persistDiscoveryAtHarnessRoot
};
