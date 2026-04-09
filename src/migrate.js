const fs = require('fs');
const path = require('path');
const os = require('os');
const { backupAssets } = require('./backup');
const { ensureDir, exists, readUtf8, replaceTemplateVariables, writeJson, writeUtf8 } = require('./fs-util');
const { matchesAnyPattern, normalize } = require('./match');
const { loadRegistry } = require('./registry');
const { MANAGED_MARKER } = require('./generate');

function createMigrationProposal(rootDir, discoveryOrOptions, loadedRegistry) {
    const harnessRoot = path.join(rootDir, 'harness');
    const guidesRoot = path.join(harnessRoot, 'guides');
    const proposalDir = path.join(harnessRoot, 'registry.d', 'discovered');
    ensureDir(proposalDir);

    const loaded = loadedRegistry || loadRegistry(rootDir);
    const discoveryInfo = resolveDiscoveryInput(rootDir, discoveryOrOptions);
    const discovery = discoveryInfo.discovery;
    const filteredAssets = filterMigratableAssets(rootDir, discovery, loaded);
    const backup = backupAssets(rootDir, filterBackupAssets(filteredAssets), 'migrate');

    const groupedGuides = {
        shared: [],
        claude: [],
        codex: []
    };
    const groupedCapabilities = new Map();

    for (const asset of filteredAssets) {
        if (asset.type === 'instruction' && (asset.target === 'claude' || asset.target === 'codex')) {
            const bucket = asset.target;
            const fileName = `${asset.scope}-${path.basename(asset.path)}`;
            const targetDir = path.join(guidesRoot, bucket, 'discovered');
            const targetFile = path.join(targetDir, fileName);
            ensureDir(targetDir);
            if (!exists(targetFile)) {
                writeUtf8(targetFile, readUtf8(asset.path));
            }
            groupedGuides[bucket].push({
                path: `discovered/${fileName}`,
                scope: asset.scope
            });
            continue;
        }

        const groupKey = `${asset.scope}-${asset.target}`;
        if (!groupedCapabilities.has(groupKey)) {
            groupedCapabilities.set(groupKey, []);
        }

        groupedCapabilities.get(groupKey).push(buildCapabilityProposal(asset));
    }

    const proposalFiles = [];
    for (const [groupKey, entries] of groupedCapabilities.entries()) {
        const filePath = path.join(proposalDir, `${groupKey}.generated.yaml`);
        const yamlLines = ['capabilities:'];

        if (entries.length === 0) {
            yamlLines.push('  []');
        }

        for (const block of entries) {
            yamlLines.push(...renderCapabilityBlock(block));
        }

        yamlLines.push('guides:');
        yamlLines.push('  shared: []');
        yamlLines.push('  claude: []');
        yamlLines.push('  codex: []');
        writeUtf8(filePath, `${yamlLines.join('\n')}\n`);
        proposalFiles.push(filePath);
    }

    const guidesFile = path.join(proposalDir, 'guides.generated.yaml');
    const guideLines = [
        'capabilities: []',
        'guides:',
        ...renderGuideEntries('shared', groupedGuides.shared),
        ...renderGuideEntries('claude', groupedGuides.claude),
        ...renderGuideEntries('codex', groupedGuides.codex)
    ];
    writeUtf8(guidesFile, `${guideLines.join('\n')}\n`);
    proposalFiles.push(guidesFile);

    const summaryPath = path.join(proposalDir, 'summary.json');
    const summary = {
        createdAt: new Date().toISOString(),
        scope: discovery.scope || discoveryInfo.scope,
        proposalFiles,
        copiedGuideCount: groupedGuides.shared.length + groupedGuides.claude.length + groupedGuides.codex.length,
        capabilityCount: Array.from(groupedCapabilities.values()).reduce((sum, items) => sum + items.length, 0),
        backup
    };
    writeJson(summaryPath, summary);

    if (discoveryInfo.tmpPath && exists(discoveryInfo.tmpPath)) {
        fs.rmSync(discoveryInfo.tmpPath, { force: true });
    }

    return Object.assign({
        proposalDir,
        summaryPath
    }, summary);
}

function resolveDiscoveryInput(rootDir, discoveryOrOptions) {
    if (discoveryOrOptions && Array.isArray(discoveryOrOptions.assets)) {
        return {
            scope: discoveryOrOptions.scope || 'project',
            discovery: discoveryOrOptions,
            tmpPath: discoveryOrOptions.tmpPath || null
        };
    }

    const options = discoveryOrOptions || {};
    const scope = options.scope || 'project';
    const tmpPath = path.join(rootDir, 'harness', 'state', `discover-${scope}-tmp.json`);

    if (!exists(tmpPath)) {
        throw new Error(`No discover output found for scope "${scope}". Run 'soft-harness discover --scope ${scope}' first.`);
    }

    return {
        scope,
        tmpPath,
        discovery: JSON.parse(readUtf8(tmpPath))
    };
}

function filterMigratableAssets(rootDir, discovery, loadedRegistry) {
    const ignorePatterns = resolvePatterns(
        ((((loadedRegistry || {}).registry || {}).defaults || {}).ignore || {}).migrate_paths || [],
        {
            rootDir,
            harnessRoot: path.join(rootDir, 'harness'),
            userHome: (discovery && discovery.userHome) || os.homedir()
        }
    );
    return (discovery.assets || []).filter((asset) => {
        if (asset.classification === 'transient') {
            return false;
        }

        const absolutePath = normalize(asset.path);
        const relativePath = normalize(asset.relativePath);
        return !matchesAnyPattern(absolutePath, ignorePatterns) && !matchesAnyPattern(relativePath, ignorePatterns);
    });
}

function resolvePatterns(patterns, pathVariables) {
    return (patterns || []).map((pattern) => replaceTemplateVariables(pattern, pathVariables));
}

function renderGuideEntries(bucket, entries) {
    const lines = [`  ${bucket}:`];
    if (entries.length === 0) {
        lines.push('    []');
        return lines;
    }

    for (const entry of entries) {
        lines.push(`    - path: ${entry.path}`);
        lines.push(`      scope: ${entry.scope}`);
    }
    return lines;
}

function buildCapabilityProposal(asset) {
    const block = {
        id: buildCapabilityId(asset),
        kind: mapAssetTypeToCapabilityKind(asset.type),
        target: asset.target,
        scope: asset.scope,
        management: asset.type === 'plugin' ? 'external' : 'discovered'
    };

    if (asset.type === 'plugin') {
        block.source = inferPluginSource(asset);
        block.install_cmd = null;
        return block;
    }

    block.truth = {
        path: asset.path
    };

    return block;
}

function renderCapabilityBlock(block) {
    const lines = [
        `  - id: ${block.id}`,
        `    kind: ${block.kind}`,
        `    target: ${block.target}`,
        `    scope: ${block.scope}`,
        `    management: ${block.management}`
    ];

    if (block.source !== undefined) {
        if (block.source === null) {
            lines.push('    source: null');
        } else {
            lines.push('    source:');
            lines.push(`      registry: ${block.source.registry}`);
            lines.push(`      package: ${block.source.package}`);
            if (block.source.version) {
                lines.push(`      version: "${block.source.version}"`);
            }
        }
        lines.push(`    install_cmd: ${block.install_cmd === null ? 'null' : block.install_cmd}`);
    }

    if (block.truth) {
        lines.push('    truth:');
        lines.push(`      path: ${block.truth.path}`);
    }

    return lines;
}

function inferPluginSource(asset) {
    const normalized = String(asset.path).replace(/\\/g, '/');
    const match = normalized.match(/\/\.claude\/plugins\/cache\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/i);
    if (!match) {
        return null;
    }

    const source = {
        registry: match[1],
        package: match[2]
    };

    if (match[3] && /^\d/.test(match[3])) {
        source.version = match[3];
    }

    return source;
}

function buildCapabilityId(asset) {
    const base = asset.relativePath || asset.idHint || path.basename(asset.path).replace(/\.[^.]+$/, '');
    return `${asset.scope}-${asset.target}-${asset.type}-${sanitize(base)}`;
}

function sanitize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function mapAssetTypeToCapabilityKind(type) {
    if (type === 'mcp-config') {
        return 'mcp';
    }
    if (type === 'instruction') {
        return 'instruction';
    }
    if (type === 'plugin') {
        return 'plugin';
    }
    if (type === 'agent') {
        return 'agent';
    }
    if (type === 'skill') {
        return 'skill';
    }
    return 'guide';
}

function filterBackupAssets(assets) {
    return assets.filter((asset) => ['instruction', 'settings', 'mcp-config', 'agent', 'skill'].includes(asset.type));
}

module.exports = {
    createMigrationProposal
};
