const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { resolveOutputPresets } = require('./presets');

const VALID_KINDS = new Set(['instruction', 'guide', 'skill', 'agent', 'plugin', 'mcp']);
const VALID_TARGETS = new Set(['claude', 'codex', 'both']);
const VALID_SCOPES = new Set(['account', 'project']);
const VALID_MANAGEMENT = new Set(['generated', 'linked', 'external', 'discovered']);
const VALID_GUIDE_BUCKETS = ['shared', 'claude', 'codex'];
const VALID_OUTPUT_GUIDE_BUCKETS = new Set(['shared', 'claude', 'codex']);
const VALID_APPLY_MODES = new Set(['copy', 'stub']);

function loadRegistry(rootDir) {
    const harnessRoot = path.join(rootDir, 'harness');
    const registryPath = path.join(harnessRoot, 'registry.yaml');
    const baseRegistry = parseYamlFile(registryPath);
    const importPaths = resolveImportPaths(registryPath, baseRegistry.imports || []);

    const importedDocs = importPaths.map((filePath) => ({
        filePath,
        document: parseYamlFile(filePath)
    }));

    const mergedRegistry = mergeRegistry(baseRegistry, importedDocs.map((item) => item.document));
    const issues = validateRegistry(mergedRegistry, harnessRoot);

    return {
        registryPath,
        importPaths,
        registry: mergedRegistry,
        issues
    };
}

function parseYamlFile(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    return YAML.parse(content) || {};
}

function resolveImportPaths(registryPath, imports) {
    const baseDir = path.dirname(registryPath);
    const resolved = [];

    for (const importPattern of imports) {
        if (typeof importPattern !== 'string') {
            continue;
        }

        if (importPattern.endsWith('*.yaml')) {
            const dirPath = path.resolve(baseDir, path.dirname(importPattern));
            if (!fs.existsSync(dirPath)) {
                continue;
            }

            const matched = fs.readdirSync(dirPath)
                .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
                .sort()
                .map((name) => path.join(dirPath, name));
            resolved.push(...matched);
            continue;
        }

        resolved.push(path.resolve(baseDir, importPattern));
    }

    return resolved;
}

function mergeRegistry(baseRegistry, importedDocs) {
    const result = {
        version: baseRegistry.version,
        meta: Object.assign({}, baseRegistry.meta),
        imports: Array.isArray(baseRegistry.imports) ? [...baseRegistry.imports] : [],
        defaults: Object.assign({}, baseRegistry.defaults),
        guides: normalizeGuides(baseRegistry.guides),
        capabilities: normalizeCapabilities(baseRegistry.capabilities),
        outputs: normalizeOutputs(baseRegistry.outputs)
    };

    for (const imported of importedDocs) {
        if (imported.version !== undefined && result.version === undefined) {
            result.version = imported.version;
        }

        Object.assign(result.meta, imported.meta || {});
        Object.assign(result.defaults, imported.defaults || {});
        mergeGuideMap(result.guides, normalizeGuides(imported.guides));
        result.capabilities.push(...normalizeCapabilities(imported.capabilities));
        result.outputs.push(...normalizeOutputs(imported.outputs));
    }

    return result;
}

function normalizeGuides(guides) {
    const normalized = {
        shared: [],
        claude: [],
        codex: []
    };

    if (!guides || typeof guides !== 'object') {
        return normalized;
    }

    for (const bucket of VALID_GUIDE_BUCKETS) {
        normalized[bucket] = Array.isArray(guides[bucket]) ? [...guides[bucket]] : [];
    }

    return normalized;
}

function mergeGuideMap(target, source) {
    for (const bucket of VALID_GUIDE_BUCKETS) {
        target[bucket].push(...source[bucket]);
    }
}

function normalizeCapabilities(capabilities) {
    if (!Array.isArray(capabilities)) {
        return [];
    }

    return capabilities.map((item) => Object.assign({}, item));
}

function normalizeOutputs(outputs) {
    if (!Array.isArray(outputs)) {
        return [];
    }

    return outputs.map((item) => resolveOutputPresets(Object.assign({}, item)));
}

function validateRegistry(registry, harnessRoot) {
    const issues = [];
    const seenIds = new Map();
    const guidesRoot = registry.defaults && registry.defaults.guides_root
        ? path.resolve(harnessRoot, registry.defaults.guides_root)
        : path.join(harnessRoot, 'guides');

    for (const capability of registry.capabilities) {
        validateCapability(capability, issues);

        if (capability && typeof capability.id === 'string') {
            if (seenIds.has(capability.id)) {
                issues.push({
                    level: 'error',
                    code: 'duplicate-capability-id',
                    message: `Duplicate capability id: ${capability.id}`
                });
            } else {
                seenIds.set(capability.id, true);
            }
        }
    }

    for (const bucket of VALID_GUIDE_BUCKETS) {
        for (const guideEntry of registry.guides[bucket]) {
            validateGuideEntry(bucket, guideEntry, guidesRoot, issues);
        }
    }

    for (const output of registry.outputs || []) {
        validateOutput(output, issues);
    }

    return issues;
}

function validateCapability(capability, issues) {
    if (!capability || typeof capability !== 'object') {
        issues.push({
            level: 'error',
            code: 'invalid-capability',
            message: 'Capability entries must be objects'
        });
        return;
    }

    if (!isNonEmptyString(capability.id)) {
        issues.push(error('missing-capability-id', 'Capability is missing a non-empty id'));
    }

    if (!VALID_KINDS.has(capability.kind)) {
        issues.push(error('invalid-capability-kind', `Capability ${capability.id || '<unknown>'} has invalid kind: ${capability.kind}`));
    }

    if (!VALID_TARGETS.has(capability.target)) {
        issues.push(error('invalid-capability-target', `Capability ${capability.id || '<unknown>'} has invalid target: ${capability.target}`));
    }

    if (!VALID_SCOPES.has(capability.scope)) {
        issues.push(error('invalid-capability-scope', `Capability ${capability.id || '<unknown>'} has invalid scope: ${capability.scope}`));
    }

    if (capability.management !== undefined && !VALID_MANAGEMENT.has(capability.management)) {
        issues.push(error('invalid-capability-management', `Capability ${capability.id || '<unknown>'} has invalid management: ${capability.management}`));
    }
}

function validateGuideEntry(bucket, guideEntry, guidesRoot, issues) {
    const entry = typeof guideEntry === 'string' ? { path: guideEntry } : guideEntry;

    if (!entry || typeof entry !== 'object' || !isNonEmptyString(entry.path)) {
        issues.push(error('invalid-guide-entry', `Guide entry in ${bucket} must provide a path`));
        return;
    }

    const expectedRoot = path.join(guidesRoot, bucket);
    const resolvedPath = path.resolve(expectedRoot, entry.path);
    const relative = path.relative(expectedRoot, resolvedPath);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        issues.push(error('guide-path-outside-bucket', `Guide path escapes ${bucket}: ${entry.path}`));
    }

    if (entry.scope !== undefined && !VALID_SCOPES.has(entry.scope)) {
        issues.push(error('invalid-guide-scope', `Guide entry in ${bucket} has invalid scope: ${entry.scope}`));
    }
}

function validateOutput(output, issues) {
    if (!output || typeof output !== 'object') {
        issues.push(error('invalid-output', 'Output entries must be objects'));
        return;
    }

    if (!isNonEmptyString(output.id)) {
        issues.push(error('missing-output-id', 'Output is missing a non-empty id'));
    }

    if (output.invalid_preset) {
        issues.push(error('invalid-output-preset', `Output ${output.id || '<unknown>'} has invalid preset: ${output.invalid_preset}`));
    }

    if (!VALID_TARGETS.has(output.target)) {
        issues.push(error('invalid-output-target', `Output ${output.id || '<unknown>'} has invalid target: ${output.target}`));
    }

    if (!VALID_SCOPES.has(output.scope)) {
        issues.push(error('invalid-output-scope', `Output ${output.id || '<unknown>'} has invalid scope: ${output.scope}`));
    }

    if (!Array.isArray(output.guide_buckets) || output.guide_buckets.length === 0) {
        issues.push(error('invalid-output-guide-buckets', `Output ${output.id || '<unknown>'} must define non-empty guide_buckets`));
    } else {
        for (const bucket of output.guide_buckets) {
            if (!VALID_OUTPUT_GUIDE_BUCKETS.has(bucket)) {
                issues.push(error('invalid-output-guide-bucket', `Output ${output.id || '<unknown>'} uses invalid guide bucket: ${bucket}`));
            }
        }
    }

    if (!isNonEmptyString(output.generated_path)) {
        issues.push(error('missing-output-generated-path', `Output ${output.id || '<unknown>'} is missing generated_path`));
    }

    if (!isNonEmptyString(output.apply_path)) {
        issues.push(error('missing-output-apply-path', `Output ${output.id || '<unknown>'} is missing apply_path`));
    }

    if (output.apply_mode !== undefined && !VALID_APPLY_MODES.has(output.apply_mode)) {
        issues.push(error('invalid-output-apply-mode', `Output ${output.id || '<unknown>'} has invalid apply_mode: ${output.apply_mode}`));
    }
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function error(code, message) {
    return {
        level: 'error',
        code,
        message
    };
}

module.exports = {
    loadRegistry,
    mergeRegistry,
    resolveImportPaths,
    validateRegistry
};
