const path = require('path');
const os = require('os');
const YAML = require('yaml');
const { ensureDir, exists, readUtf8, resolveTemplatePath, toPosixRelative, writeUtf8 } = require('./fs-util');
const { resolveInstallCmd } = require('./known-registries');

const MANAGED_MARKER = '<!-- Managed by soft-harness v1. Edit guides under harness/ not here. -->';

function generateOutputs(rootDir, loadedRegistry, options) {
    const generated = [];
    const harnessRoot = (options && options.harnessRoot) || path.join(rootDir, 'harness');
    const variables = createPathVariables(rootDir, harnessRoot, options);
    const registry = getRegistryObject(loadedRegistry);
    const guidesRoot = registry.defaults && registry.defaults.guides_root
        ? path.resolve(harnessRoot, registry.defaults.guides_root)
        : path.join(harnessRoot, 'guides');

    resolveAndPersistInstallCommands(loadedRegistry, registry);

    for (const output of registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const applyPath = resolveTemplatePath(output.apply_path, variables, harnessRoot);
        const content = buildOutputContent(output, registry, guidesRoot, rootDir);
        ensureDir(path.dirname(applyPath));
        writeUtf8(applyPath, content);

        generated.push({
            id: output.id,
            target: output.target,
            scope: output.scope,
            applyPath
        });
    }

    return generated;
}

function buildOutputContent(output, registry, guidesRoot, rootDir) {
    if (typeof output._content === 'string') {
        return output._content.endsWith('\n') ? output._content : `${output._content}\n`;
    }

    if (output.content_type === 'mcp-json') {
        return buildMcpOutput(output, registry);
    }

    const guideMap = registry.guides || {};
    const lines = [];
    const guideBuckets = Array.isArray(output.guide_buckets) ? output.guide_buckets : [];

    lines.push(MANAGED_MARKER);
    lines.push(`# ${output.id}`);
    lines.push('');
    lines.push(`- target: ${output.target}`);
    lines.push(`- scope: ${output.scope}`);
    lines.push('');

    for (const bucket of guideBuckets) {
        const entries = Array.isArray(guideMap[bucket]) ? guideMap[bucket] : [];
        const matchingEntries = entries
            .map((entry) => normalizeGuideEntry(entry))
            .filter((entry) => entry.scope === output.scope);

        for (const entry of matchingEntries) {
            const fullPath = path.resolve(guidesRoot, bucket, entry.path);
            if (!exists(fullPath)) {
                continue;
            }

            lines.push('---');
            lines.push(`source: ${toPosixRelative(rootDir, fullPath)}`);
            lines.push('');
            lines.push(readUtf8(fullPath).trimEnd());
            lines.push('');
        }
    }

    return `${lines.join('\n')}\n`;
}

function buildMcpOutput(output, registry) {
    const capabilityIds = Array.isArray(output.capability_ids) ? new Set(output.capability_ids) : null;
    const servers = {};

    for (const capability of registry.capabilities || []) {
        if (capability.kind !== 'mcp' || capability.enabled === false) {
            continue;
        }

        if (capabilityIds && !capabilityIds.has(capability.id)) {
            continue;
        }

        if (capability.scope !== output.scope) {
            continue;
        }

        if (!(capability.target === output.target || capability.target === 'both' || output.target === 'both')) {
            continue;
        }

        const serverId = capability.server_id || capability.id;
        servers[serverId] = capability.server || {};
    }

    return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

function createPathVariables(rootDir, harnessRoot, options) {
    return {
        rootDir,
        harnessRoot,
        userHome: (options && options.userHome) || os.homedir()
    };
}

function normalizeGuideEntry(entry) {
    if (typeof entry === 'string') {
        return {
            path: entry,
            scope: 'project'
        };
    }

    return Object.assign({
        scope: 'project'
    }, entry);
}

function getRegistryObject(loadedRegistry) {
    return loadedRegistry && loadedRegistry.registry ? loadedRegistry.registry : (loadedRegistry || {});
}

function resolveAndPersistInstallCommands(loadedRegistry, registry) {
    const capabilities = registry.capabilities || [];
    const resolved = [];

    for (const capability of capabilities) {
        if (capability.management !== 'external') {
            continue;
        }

        const installCmd = resolveInstallCmd(capability.source || null);
        if (!installCmd) {
            continue;
        }

        capability.install_cmd = installCmd;
        resolved.push({
            id: capability.id,
            installCmd
        });
    }

    const candidateFiles = getRegistryFileCandidates(loadedRegistry, registry);
    if (resolved.length === 0 || candidateFiles.length === 0) {
        return;
    }

    for (const filePath of candidateFiles) {
        persistInstallCommands(filePath, resolved);
    }
}

function getRegistryFileCandidates(loadedRegistry, registry) {
    if (loadedRegistry && loadedRegistry.registryPath) {
        return [loadedRegistry.registryPath].concat(loadedRegistry.importPaths || []);
    }

    if (registry && registry.__registryPath) {
        return [registry.__registryPath].concat(registry.__importPaths || []);
    }

    return [];
}

function persistInstallCommands(filePath, resolvedInstallCommands) {
    if (!exists(filePath)) {
        return;
    }

    const raw = readUtf8(filePath);
    const document = YAML.parseDocument(raw);
    const capabilitiesNode = document.get('capabilities', true);
    if (!capabilitiesNode || !Array.isArray(capabilitiesNode.items)) {
        return;
    }

    let changed = false;
    for (const capabilityNode of capabilitiesNode.items) {
        const id = capabilityNode.get('id');
        if (!id) {
            continue;
        }

        const match = resolvedInstallCommands.find((item) => item.id === id);
        if (!match) {
            continue;
        }

        if (capabilityNode.get('install_cmd') === match.installCmd) {
            continue;
        }

        capabilityNode.set('install_cmd', match.installCmd);
        changed = true;
    }

    if (changed) {
        writeUtf8(filePath, document.toString());
    }
}

module.exports = {
    MANAGED_MARKER,
    buildOutputContent,
    createPathVariables,
    generateOutputs,
    getRegistryObject
};
