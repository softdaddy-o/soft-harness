const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const { resolveImportPaths } = require('./registry');
const { LEGACY_STUB_PRESETS } = require('./presets');
const { MANAGED_MARKER } = require('./generate');

function migrateSchema(rootDir, options) {
    const settings = Object.assign({
        apply: false,
        force: false
    }, options);
    if (settings.dryRun === undefined) {
        settings.dryRun = !settings.apply;
    }
    const harnessRoot = path.join(rootDir, 'harness');
    const registryPath = path.join(harnessRoot, 'registry.yaml');

    if (!fs.existsSync(registryPath)) {
        throw new Error(`No registry.yaml found at ${registryPath}`);
    }

    const baseRaw = fs.readFileSync(registryPath, 'utf8');
    const baseParsed = YAML.parse(baseRaw) || {};
    const filesToPatch = [registryPath, ...resolveImportPaths(registryPath, baseParsed.imports || [])];
    const changes = [];
    const warnings = [];
    const patches = [];

    for (const filePath of filesToPatch) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = YAML.parse(raw) || {};
        const document = YAML.parseDocument(raw);

        if ((parsed.version ?? 0) >= 1) {
            continue;
        }

        collectWarnings(rootDir, harnessRoot, parsed, warnings);
        const fileChanges = patchDocument(document, parsed);
        if (fileChanges.length > 0) {
            patches.push({ filePath, document });
            changes.push(...fileChanges.map((entry) => `${path.relative(harnessRoot, filePath) || 'registry.yaml'}: ${entry}`));
        }
    }

    if (!settings.dryRun && settings.apply) {
        if (warnings.length > 0 && !settings.force) {
            throw new Error(`Schema migration halted due to warnings:\n- ${warnings.join('\n- ')}`);
        }

        const backupDir = path.join(harnessRoot, 'state', 'backups', 'schema-v0-backup');
        fs.mkdirSync(backupDir, { recursive: true });

        for (const patch of patches) {
            const relativePath = path.relative(harnessRoot, patch.filePath);
            const backupPath = path.join(backupDir, relativePath);
            fs.mkdirSync(path.dirname(backupPath), { recursive: true });
            fs.copyFileSync(patch.filePath, backupPath);
            fs.writeFileSync(patch.filePath, patch.document.toString(), 'utf8');
        }
    }

    if (patches.length === 0) {
        changes.push('Already at v1 or no changes required.');
    }

    return { changes, warnings };
}

function collectWarnings(rootDir, harnessRoot, parsed, warnings) {
    for (const output of parsed.outputs || []) {
        const applyPath = output.apply_path ? resolvePath(output.apply_path, rootDir, harnessRoot) : null;
        const generatedPath = output.generated_path ? resolvePath(output.generated_path, rootDir, harnessRoot) : null;

        if (output.apply_mode === 'stub' && applyPath && fs.existsSync(applyPath)) {
            const content = fs.readFileSync(applyPath, 'utf8');
            if (!content.startsWith(MANAGED_MARKER)) {
                warnings.push(`Output "${output.id}" uses stub mode and target "${output.apply_path}" looks hand-edited.`);
            }
        }

        if (generatedPath && !fs.existsSync(generatedPath)) {
            warnings.push(`Output "${output.id}" references missing generated_path "${output.generated_path}".`);
        }
    }
}

function patchDocument(document, parsed) {
    const changes = [];

    if ((parsed.version ?? 0) < 1) {
        document.set('version', 1);
        changes.push('version: 0 -> 1');
    }

    const outputsNode = document.get('outputs', true);
    if (outputsNode && Array.isArray(outputsNode.items)) {
        for (const outputNode of outputsNode.items) {
            const outputId = outputNode.get('id') || '<unknown>';
            const preset = outputNode.get('preset');

            if (preset && LEGACY_STUB_PRESETS[preset]) {
                outputNode.set('preset', LEGACY_STUB_PRESETS[preset]);
                changes.push(`output "${outputId}": preset "${preset}" -> "${LEGACY_STUB_PRESETS[preset]}"`);
            }

            if (outputNode.has('generated_path')) {
                outputNode.delete('generated_path');
                changes.push(`output "${outputId}": removed generated_path`);
            }

            if (outputNode.has('apply_mode')) {
                outputNode.delete('apply_mode');
                changes.push(`output "${outputId}": removed apply_mode`);
            }
        }
    }

    const capabilitiesNode = document.get('capabilities', true);
    if (capabilitiesNode && Array.isArray(capabilitiesNode.items)) {
        for (const capabilityNode of capabilitiesNode.items) {
            if (capabilityNode.get('management') !== 'external') {
                continue;
            }

            const capabilityId = capabilityNode.get('id') || '<unknown>';
            if (!capabilityNode.has('source')) {
                capabilityNode.set('source', null);
                changes.push(`capability "${capabilityId}": added source: null`);
            }

            if (!capabilityNode.has('install_cmd')) {
                capabilityNode.set('install_cmd', null);
                changes.push(`capability "${capabilityId}": added install_cmd: null`);
            }
        }
    }

    return changes;
}

function resolvePath(templatePath, rootDir, harnessRoot) {
    const userHome = process.env.HOME || process.env.USERPROFILE || '';
    const replaced = String(templatePath)
        .replaceAll('{rootDir}', rootDir)
        .replaceAll('{harnessRoot}', harnessRoot)
        .replaceAll('{userHome}', userHome);

    if (path.isAbsolute(replaced)) {
        return path.resolve(replaced);
    }

    return path.resolve(harnessRoot, replaced);
}

module.exports = {
    migrateSchema
};
