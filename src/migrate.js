const path = require('path');
const { backupAssets } = require('./backup');
const { ensureDir, exists, readUtf8, writeJson, writeUtf8 } = require('./fs-util');
const { matchesAnyPattern, normalize } = require('./match');

function createMigrationProposal(rootDir, discovery, loadedRegistry) {
    const harnessRoot = path.join(rootDir, 'harness');
    const guidesRoot = path.join(harnessRoot, 'guides');
    const proposalDir = path.join(harnessRoot, 'registry.d', 'discovered');
    ensureDir(proposalDir);

    const filteredAssets = filterMigratableAssets(discovery.assets || [], loadedRegistry);
    const backup = backupAssets(rootDir, filterBackupAssets(filteredAssets), 'migrate');

    const groupedGuides = {
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

        groupedCapabilities.get(groupKey).push({
            id: buildCapabilityId(asset),
            kind: mapAssetTypeToCapabilityKind(asset.type),
            target: asset.target,
            scope: asset.scope,
            management: asset.type === 'plugin' ? 'external' : 'discovered',
            truth: {
                path: asset.path
            }
        });
    }

    const proposalFiles = [];
    for (const [groupKey, entries] of groupedCapabilities.entries()) {
        const filePath = path.join(proposalDir, `${groupKey}.generated.yaml`);
        const yamlLines = ['capabilities:'];

        for (const block of entries) {
            yamlLines.push(`  - id: ${block.id}`);
            yamlLines.push(`    kind: ${block.kind}`);
            yamlLines.push(`    target: ${block.target}`);
            yamlLines.push(`    scope: ${block.scope}`);
            yamlLines.push(`    management: ${block.management}`);
            yamlLines.push('    truth:');
            yamlLines.push(`      path: ${block.truth.path}`);
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
        'capabilities:',
        'guides:',
        ...renderGuideEntries('shared', []),
        ...renderGuideEntries('claude', groupedGuides.claude),
        ...renderGuideEntries('codex', groupedGuides.codex)
    ];
    writeUtf8(guidesFile, `${guideLines.join('\n')}\n`);
    proposalFiles.push(guidesFile);

    const summaryPath = path.join(proposalDir, 'summary.json');
    const summary = {
        createdAt: new Date().toISOString(),
        proposalFiles,
        copiedGuideCount: groupedGuides.claude.length + groupedGuides.codex.length,
        capabilityCount: Array.from(groupedCapabilities.values()).reduce((sum, items) => sum + items.length, 0),
        backup
    };
    writeJson(summaryPath, summary);

    return Object.assign({
        proposalDir,
        summaryPath
    }, summary);
}

function filterMigratableAssets(assets, loadedRegistry) {
    const ignorePatterns = ((((loadedRegistry || {}).registry || {}).defaults || {}).ignore || {}).migrate_paths || [];
    return assets.filter((asset) => {
        if (asset.classification === 'transient') {
            return false;
        }

        const absolutePath = normalize(asset.path);
        const relativePath = normalize(asset.relativePath);
        return !matchesAnyPattern(absolutePath, ignorePatterns) && !matchesAnyPattern(relativePath, ignorePatterns);
    });
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
