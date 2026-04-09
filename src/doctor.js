const path = require('path');
const os = require('os');
const { exists, readUtf8, replaceTemplateVariables, resolveTemplatePath } = require('./fs-util');
const { matchesAnyPattern, normalize } = require('./match');
const { MANAGED_MARKER } = require('./generate');

function runDoctor(rootDir, loadedRegistry, discovery, options) {
    const normalizedLoaded = normalizeLoadedRegistry(loadedRegistry);
    const findings = [...normalizedLoaded.issues];
    const registry = normalizedLoaded.registry;
    const harnessRoot = (options && options.harnessRoot) || path.join(rootDir, 'harness');
    const pathVariables = createPathVariables(rootDir, harnessRoot, discovery);
    const guidesRoot = registry.defaults && registry.defaults.guides_root
        ? resolveTemplatePath(registry.defaults.guides_root, pathVariables, harnessRoot)
        : path.join(harnessRoot, 'guides');

    for (const bucket of ['shared', 'claude', 'codex']) {
        for (const guideEntry of registry.guides[bucket] || []) {
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

    const unmanaged = findUnmanagedDiscoveredAssets(registry, (discovery && discovery.assets) || [], pathVariables);
    findings.push(...unmanaged.map((asset) => ({
        level: 'warning',
        code: 'unmanaged-discovered-asset',
        message: `Discovered asset is not represented in the registry: ${asset.path}`
    })));

    findings.push(...findMissingInstallCmds(registry));
    findings.push(...findUnmanagedApplyTargets(rootDir, registry, pathVariables));

    if (!options || options.includeProjectMcp !== false) {
        findings.push(...findPlaintextSecretFindings(rootDir));
    }

    return findings;
}

function normalizeLoadedRegistry(loadedRegistry) {
    if (loadedRegistry && loadedRegistry.registry) {
        return loadedRegistry;
    }

    return {
        issues: loadedRegistry && Array.isArray(loadedRegistry.issues) ? loadedRegistry.issues : [],
        registry: loadedRegistry || { capabilities: [], guides: { shared: [], claude: [], codex: [] }, outputs: [] }
    };
}

function findMissingInstallCmds(registry) {
    const findings = [];
    for (const capability of registry.capabilities || []) {
        if (capability.management === 'external' && !capability.install_cmd) {
            findings.push({
                level: 'warning',
                code: 'MISSING_INSTALL_CMD',
                message: `External capability "${capability.id}" has no install_cmd. Set source.registry or add install_cmd manually.`
            });
        }
    }
    return findings;
}

function findUnmanagedApplyTargets(rootDir, registry, pathVariables) {
    const findings = [];

    for (const output of registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        if ((output.content_type || 'guide-bundle') === 'mcp-json') {
            continue;
        }

        const applyPath = resolveTemplatePath(output.apply_path, pathVariables, pathVariables.harnessRoot);
        if (!exists(applyPath)) {
            continue;
        }

        const content = readUtf8(applyPath);
        if (!content.startsWith(MANAGED_MARKER)) {
            findings.push({
                level: 'warning',
                code: 'UNMANAGED_APPLY_TARGET',
                message: `Output "${output.id}" target "${output.apply_path}" exists but is not managed by soft-harness. Run 'apply --force' to take ownership or move the file.`
            });
        }
    }

    return findings;
}

function findUnmanagedDiscoveredAssets(registry, assets, pathVariables) {
    const managedPaths = new Set();
    const ignorePatterns = resolvePatterns((((registry.defaults || {}).ignore || {}).doctor_paths) || [], pathVariables);

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

function createPathVariables(rootDir, harnessRoot, discovery) {
    return {
        rootDir,
        harnessRoot,
        userHome: (discovery && discovery.userHome) || os.homedir()
    };
}

function resolvePatterns(patterns, pathVariables) {
    return (patterns || []).map((pattern) => replaceTemplateVariables(pattern, pathVariables));
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
