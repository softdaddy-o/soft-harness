const fs = require('fs');
const path = require('path');
const os = require('os');
const { buildOutputContent, createPathVariables, getRegistryObject, MANAGED_MARKER } = require('./generate');
const { ensureDir, exists, readUtf8, resolveTemplatePath, writeJson, writeUtf8 } = require('./fs-util');

function applyOutputs(rootDir, loadedRegistry, options) {
    const settings = Object.assign({
        dryRun: false,
        yes: false,
        force: false,
        backup: false,
        reason: null
    }, options);
    const harnessRoot = settings.harnessRoot || path.join(rootDir, 'harness');
    const variables = createPathVariables(rootDir, harnessRoot, settings);
    const registry = getRegistryObject(loadedRegistry);
    const guidesRoot = registry.defaults && registry.defaults.guides_root
        ? path.resolve(harnessRoot, registry.defaults.guides_root)
        : path.join(harnessRoot, 'guides');
    const results = [];
    const backupFiles = [];

    for (const output of registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const applyPath = resolveTemplatePath(output.apply_path, variables, harnessRoot);
        const desiredContent = buildOutputContent(output, registry, guidesRoot, rootDir);
        const contentType = output.content_type || 'guide-bundle';
        const hasExistingFile = exists(applyPath);
        const existingContent = hasExistingFile ? readUtf8(applyPath) : null;
        const unmanaged = hasExistingFile && contentType !== 'mcp-json' && !existingContent.startsWith(MANAGED_MARKER);
        const changed = existingContent !== desiredContent;

        if (!changed) {
            results.push({
                id: output.id,
                status: 'unchanged',
                unmanaged,
                applyPath,
                diff: null
            });
            continue;
        }

        if (settings.dryRun) {
            results.push({
                id: output.id,
                status: 'would-write',
                unmanaged,
                applyPath,
                diff: createDiff(existingContent, desiredContent)
            });
            continue;
        }

        if (unmanaged && !settings.force) {
            results.push({
                id: output.id,
                status: 'skipped-unmanaged',
                unmanaged: true,
                applyPath,
                diff: createDiff(existingContent, desiredContent)
            });
            continue;
        }

        if (settings.backup && hasExistingFile) {
            backupFiles.push({
                original: output.apply_path,
                absolutePath: applyPath
            });
        }

        writeUtf8(applyPath, desiredContent);
        results.push({
            id: output.id,
            status: 'written',
            unmanaged,
            applyPath,
            diff: createDiff(existingContent, desiredContent)
        });
    }

    if (!settings.dryRun && settings.backup && backupFiles.length > 0) {
        writeBackupManifest(harnessRoot, backupFiles, settings.reason || 'apply --backup');
    }

    return results;
}

function createDiff(before, after) {
    if (before === null || before === undefined) {
        return { before: null, after };
    }

    if (before === after) {
        return null;
    }

    return { before, after };
}

function writeBackupManifest(harnessRoot, files, reason) {
    const timestamp = new Date().toISOString();
    const backupDir = path.join(harnessRoot, 'state', 'backups', timestamp.replace(/[:.]/g, '-'));
    ensureDir(backupDir);

    const manifest = {
        timestamp,
        reason,
        files: []
    };

    for (const file of files) {
        const backedUpAs = path.basename(file.absolutePath);
        const targetPath = path.join(backupDir, backedUpAs);
        writeUtf8(targetPath, readUtf8(file.absolutePath));
        manifest.files.push({
            original: file.original,
            backed_up_as: backedUpAs
        });
    }

    writeJson(path.join(backupDir, 'manifest.json'), manifest);
    return backupDir;
}

module.exports = {
    MANAGED_MARKER,
    applyOutputs
};
