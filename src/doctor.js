const path = require('path');
const { exists, readUtf8 } = require('./fs-util');
const { matchesAnyPattern, normalize } = require('./match');

function runDoctor(rootDir, loadedRegistry, discovery) {
    const findings = [...loadedRegistry.issues];
    const harnessRoot = path.join(rootDir, 'harness');
    const guidesRoot = loadedRegistry.registry.defaults && loadedRegistry.registry.defaults.guides_root
        ? path.resolve(harnessRoot, loadedRegistry.registry.defaults.guides_root)
        : path.join(harnessRoot, 'guides');

    for (const bucket of ['shared', 'claude', 'codex']) {
        for (const guideEntry of loadedRegistry.registry.guides[bucket] || []) {
            const entry = typeof guideEntry === 'string' ? { path: guideEntry, scope: 'project' } : guideEntry;
            const guidePath = path.resolve(guidesRoot, bucket, entry.path);
            if (!exists(guidePath)) {
                findings.push({
                    level: 'error',
                    code: 'missing-guide-file',
                    message: `Guide file is missing: ${guidePath}`
                });
            }
        }
    }

    for (const output of loadedRegistry.registry.outputs || []) {
        const generatedPath = path.resolve(harnessRoot, output.generated_path);
        if (output.enabled !== false && !exists(generatedPath)) {
            findings.push({
                level: 'warning',
                code: 'missing-generated-output',
                message: `Output has not been generated yet: ${generatedPath}`
            });
        }
    }

    const unmanaged = findUnmanagedDiscoveredAssets(loadedRegistry.registry, discovery.assets || []);
    findings.push(...unmanaged.map((asset) => ({
        level: 'warning',
        code: 'unmanaged-discovered-asset',
        message: `Discovered asset is not represented in the registry: ${asset.path}`
    })));

    findings.push(...findPlaintextSecretFindings(rootDir));

    return findings;
}

function findUnmanagedDiscoveredAssets(registry, assets) {
    const managedPaths = new Set();
    const ignorePatterns = (((registry.defaults || {}).ignore || {}).doctor_paths) || [];

    for (const bucket of ['shared', 'claude', 'codex']) {
        for (const guideEntry of registry.guides[bucket] || []) {
            const entry = typeof guideEntry === 'string' ? { path: guideEntry } : guideEntry;
            if (entry.path) {
                managedPaths.add(normalize(entry.path));
            }
        }
    }

    for (const capability of registry.capabilities || []) {
        if (capability.truth && capability.truth.path) {
            managedPaths.add(normalize(capability.truth.path));
        }
    }

    return assets.filter((asset) => {
        if (asset.classification === 'transient') {
            return false;
        }

        const absolutePath = normalize(asset.path);
        const relativePath = normalize(asset.relativePath);
        if (matchesAnyPattern(absolutePath, ignorePatterns) || matchesAnyPattern(relativePath, ignorePatterns)) {
            return false;
        }

        return !managedPaths.has(absolutePath) && !managedPaths.has(relativePath);
    });
}

function findPlaintextSecretFindings(rootDir) {
    const findings = [];
    const mcpPath = path.join(rootDir, '.mcp.json');
    if (!exists(mcpPath)) {
        return findings;
    }

    const content = readUtf8(mcpPath);
    const suspicious = /(Authorization|TOKEN|token|secret|api[_-]?key|access-token)/;
    if (suspicious.test(content) && !/YOUR_TOKEN_HERE|<replace|example|changeme/i.test(content)) {
        findings.push({
            level: 'error',
            code: 'plaintext-secret-in-config',
            message: `Possible plaintext secret found in ${mcpPath}`
        });
    }

    return findings;
}

module.exports = {
    runDoctor
};
