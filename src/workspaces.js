const fs = require('fs');
const os = require('os');
const path = require('path');
const YAML = require('yaml');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');

function getWorkspaceRegistryPath(options) {
    const userHome = (options && options.userHome) || os.homedir();
    return path.join(userHome, '.soft-harness', 'workspaces.yaml');
}

function loadWorkspaceRegistry(options) {
    const registryPath = getWorkspaceRegistryPath(options);
    if (!exists(registryPath)) {
        return {
            registryPath,
            registry: {
                version: 1,
                workspaces: []
            }
        };
    }

    const parsed = YAML.parse(readUtf8(registryPath)) || {};
    return {
        registryPath,
        registry: {
            version: parsed.version || 1,
            workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces.map((item) => Object.assign({}, item)) : []
        }
    };
}

function saveWorkspaceRegistry(registryPath, registry) {
    ensureDir(path.dirname(registryPath));
    writeUtf8(registryPath, `${YAML.stringify(registry)}`);
}

function addWorkspace(workspacePath, options) {
    const resolvedPath = path.resolve(workspacePath);
    const loaded = loadWorkspaceRegistry(options);
    const existing = loaded.registry.workspaces.find((item) => samePath(item.path, resolvedPath));

    if (existing) {
        return {
            action: 'existing',
            registryPath: loaded.registryPath,
            workspace: existing
        };
    }

    const workspace = {
        id: createWorkspaceId(loaded.registry.workspaces, resolvedPath),
        path: resolvedPath,
        enabled: true,
        targets: ['claude', 'codex']
    };

    loaded.registry.workspaces.push(workspace);
    loaded.registry.workspaces.sort((left, right) => left.id.localeCompare(right.id));
    saveWorkspaceRegistry(loaded.registryPath, loaded.registry);

    return {
        action: 'added',
        registryPath: loaded.registryPath,
        workspace
    };
}

function removeWorkspace(workspacePath, options) {
    const resolvedPath = path.resolve(workspacePath);
    const loaded = loadWorkspaceRegistry(options);
    const beforeCount = loaded.registry.workspaces.length;
    loaded.registry.workspaces = loaded.registry.workspaces.filter((item) => !samePath(item.path, resolvedPath));

    if (loaded.registry.workspaces.length === beforeCount) {
        return {
            action: 'missing',
            registryPath: loaded.registryPath
        };
    }

    saveWorkspaceRegistry(loaded.registryPath, loaded.registry);
    return {
        action: 'removed',
        registryPath: loaded.registryPath
    };
}

function listWorkspaces(options) {
    return loadWorkspaceRegistry(options);
}

function samePath(left, right) {
    return normalizePath(left) === normalizePath(right);
}

function normalizePath(inputPath) {
    return path.resolve(inputPath).replace(/\\/g, '/').toLowerCase();
}

function createWorkspaceId(workspaces, workspacePath) {
    const baseName = path.basename(workspacePath) || 'workspace';
    const slug = baseName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'workspace';

    const seen = new Set(workspaces.map((item) => item.id));
    if (!seen.has(slug)) {
        return slug;
    }

    let index = 2;
    while (seen.has(`${slug}-${index}`)) {
        index += 1;
    }
    return `${slug}-${index}`;
}

function hasWorkspaceMarkers(workspacePath) {
    const resolvedPath = path.resolve(workspacePath);
    return exists(path.join(resolvedPath, '.git')) || exists(path.join(resolvedPath, 'harness', 'registry.yaml'));
}

module.exports = {
    addWorkspace,
    getWorkspaceRegistryPath,
    hasWorkspaceMarkers,
    listWorkspaces,
    loadWorkspaceRegistry,
    removeWorkspace
};
