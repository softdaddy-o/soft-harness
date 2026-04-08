const path = require('path');
const { backupAssets } = require('./backup');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');

function createMigrationProposal(rootDir, discovery) {
    const harnessRoot = path.join(rootDir, 'harness');
    const guidesRoot = path.join(harnessRoot, 'guides');
    const proposalPath = path.join(harnessRoot, 'registry.d', 'discovered.generated.yaml');
    const guideEntries = {
        claude: [],
        codex: []
    };
    const capabilityBlocks = [];
    const backup = backupAssets(rootDir, filterBackupAssets(discovery.assets || []), 'migrate');

    for (const asset of discovery.assets || []) {
        if (asset.type === 'instruction' && (asset.target === 'claude' || asset.target === 'codex')) {
            const bucket = asset.target;
            const fileName = `${asset.scope}-${path.basename(asset.path)}`;
            const targetDir = path.join(guidesRoot, bucket, 'discovered');
            const targetFile = path.join(targetDir, fileName);
            ensureDir(targetDir);
            if (!exists(targetFile)) {
                writeUtf8(targetFile, readUtf8(asset.path));
            }
            guideEntries[bucket].push({
                path: `discovered/${fileName}`,
                scope: asset.scope
            });
            continue;
        }

        capabilityBlocks.push({
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

    const yamlLines = ['capabilities:'];
    for (const block of capabilityBlocks) {
        yamlLines.push(`  - id: ${block.id}`);
        yamlLines.push(`    kind: ${block.kind}`);
        yamlLines.push(`    target: ${block.target}`);
        yamlLines.push(`    scope: ${block.scope}`);
        yamlLines.push(`    management: ${block.management}`);
        yamlLines.push('    truth:');
        yamlLines.push(`      path: ${block.truth.path}`);
    }

    yamlLines.push('guides:');
    yamlLines.push(...renderGuideEntries('shared', []));
    yamlLines.push(...renderGuideEntries('claude', guideEntries.claude));
    yamlLines.push(...renderGuideEntries('codex', guideEntries.codex));

    writeUtf8(proposalPath, `${yamlLines.join('\n')}\n`);

    return {
        proposalPath,
        copiedGuideCount: guideEntries.claude.length + guideEntries.codex.length,
        capabilityCount: capabilityBlocks.length,
        backup
    };
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

module.exports = {
    createMigrationProposal
};

function filterBackupAssets(assets) {
    return assets.filter((asset) => ['instruction', 'settings', 'mcp-config', 'agent', 'skill'].includes(asset.type));
}
