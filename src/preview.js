const fs = require('fs');
const path = require('path');
const { applyOutputs } = require('./apply');
const { diffOutputs } = require('./diff');
const { discoverState } = require('./discover');
const { runDoctor } = require('./doctor');
const { exists, readUtf8 } = require('./fs-util');
const { loadRegistry } = require('./registry');

function collectPreview(rootDir, loadedRegistry, options) {
    const settings = Object.assign({
        scope: 'project'
    }, options);
    const harnessRoot = settings.harnessRoot || path.join(rootDir, 'harness');
    const loaded = loadedRegistry || loadRegistry(rootDir);
    const discovery = settings.discovery || discoverState(rootDir, {
        scope: settings.scope,
        userHome: settings.userHome,
        persist: false
    });
    const findings = runDoctor(rootDir, loaded, discovery, settings.doctorOptions);
    const diffs = diffOutputs(rootDir, loaded, {
        harnessRoot,
        userHome: discovery.userHome
    });
    const applyPreview = applyOutputs(rootDir, loaded, {
        harnessRoot,
        userHome: discovery.userHome,
        dryRun: true
    });

    return {
        rootDir,
        harnessRoot,
        registry: summarizeRegistry(loaded),
        discovery: summarizeDiscovery(discovery),
        proposals: summarizeProposals(harnessRoot),
        doctor: summarizeDoctor(findings),
        diff: summarizeStatuses(diffs, 'status'),
        apply: summarizeStatuses(applyPreview, 'status'),
        details: {
            discoveryAssets: (discovery.assets || []).map((asset) => ({
                type: asset.type,
                target: asset.target,
                scope: asset.scope,
                classification: asset.classification,
                path: asset.path
            })),
            proposalFiles: collectProposalFiles(harnessRoot),
            doctorFindings: findings.map((finding) => ({
                level: finding.level,
                code: finding.code,
                message: finding.message
            })),
            diffs: diffs.map((diff) => ({
                id: diff.id,
                status: diff.status,
                applyPath: diff.applyPath
            })),
            applyPreview: applyPreview.map((item) => ({
                id: item.id,
                status: item.status,
                unmanaged: Boolean(item.unmanaged),
                applyPath: item.applyPath
            }))
        }
    };
}

function summarizeRegistry(loaded) {
    const guideCount = Object.values((loaded.registry && loaded.registry.guides) || {})
        .reduce((sum, items) => sum + items.length, 0);

    return {
        path: loaded.registryPath,
        imports: (loaded.importPaths || []).length,
        capabilities: (loaded.registry.capabilities || []).length,
        guides: guideCount,
        outputs: (loaded.registry.outputs || []).length,
        issues: (loaded.issues || []).length
    };
}

function summarizeDiscovery(discovery) {
    return {
        scope: discovery.scope,
        assets: (discovery.assets || []).length,
        tmpPath: discovery.tmpPath,
        persisted: discovery.tmpPath ? exists(discovery.tmpPath) : false
    };
}

function summarizeProposals(harnessRoot) {
    const proposalDir = path.join(harnessRoot, 'registry.d', 'discovered');
    const summaryPath = path.join(proposalDir, 'summary.json');

    if (!exists(proposalDir)) {
        return {
            pending: 0,
            copiedGuides: 0,
            capabilityProposals: 0,
            summaryPath: null
        };
    }

    let copiedGuides = 0;
    let capabilityProposals = 0;
    let pending = 0;

    if (exists(summaryPath)) {
        const summary = JSON.parse(readUtf8(summaryPath));
        copiedGuides = summary.copiedGuideCount || 0;
        capabilityProposals = summary.capabilityCount || 0;
        pending = Array.isArray(summary.proposalFiles) ? summary.proposalFiles.length : 0;
    } else {
        pending = fs.readdirSync(proposalDir)
            .filter((name) => name.endsWith('.generated.yaml'))
            .length;
    }

    return {
        pending,
        copiedGuides,
        capabilityProposals,
        summaryPath: exists(summaryPath) ? summaryPath : null
    };
}

function collectProposalFiles(harnessRoot) {
    const proposalDir = path.join(harnessRoot, 'registry.d', 'discovered');
    const summaryPath = path.join(proposalDir, 'summary.json');

    if (!exists(proposalDir)) {
        return [];
    }

    if (exists(summaryPath)) {
        const summary = JSON.parse(readUtf8(summaryPath));
        if (Array.isArray(summary.proposalFiles)) {
            return summary.proposalFiles.map((filePath) => path.resolve(proposalDir, path.basename(filePath)));
        }
    }

    return fs.readdirSync(proposalDir)
        .filter((name) => name.endsWith('.generated.yaml'))
        .map((name) => path.join(proposalDir, name));
}

function summarizeDoctor(findings) {
    const grouped = new Map();
    let errors = 0;
    let warnings = 0;

    for (const finding of findings) {
        if (finding.level === 'error') {
            errors += 1;
        }
        if (finding.level === 'warning') {
            warnings += 1;
        }

        const key = `${finding.level}:${finding.code}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                level: finding.level,
                code: finding.code,
                count: 0
            });
        }

        grouped.get(key).count += 1;
    }

    return {
        errors,
        warnings,
        findings: findings.length,
        groups: Array.from(grouped.values())
    };
}

function summarizeStatuses(items, key) {
    const counts = {};

    for (const item of items) {
        const status = item[key];
        counts[status] = (counts[status] || 0) + 1;
    }

    return {
        total: items.length,
        counts
    };
}

module.exports = {
    collectPreview
};
