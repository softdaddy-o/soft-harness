const fs = require('fs');
const path = require('path');
const { ensureDir, exists, readUtf8, toPosixRelative, writeJson, writeUtf8 } = require('./fs-util');

function backupAssets(rootDir, assets, label) {
    const backupId = createBackupId(label);
    const backupRoot = path.join(rootDir, 'harness', 'state', 'backups', backupId);
    const filesRoot = path.join(backupRoot, 'files');
    const manifest = {
        backupId,
        createdAt: new Date().toISOString(),
        label,
        entries: []
    };

    ensureDir(filesRoot);

    for (const asset of assets) {
        if (!asset.path || !exists(asset.path)) {
            continue;
        }

        const stat = fs.statSync(asset.path);
        if (!stat.isFile()) {
            manifest.entries.push({
                path: asset.path,
                type: asset.type,
                scope: asset.scope,
                backedUp: false,
                reason: 'not-a-file'
            });
            continue;
        }

        const relativeName = sanitizeBackupPath(asset.path);
        const backupPath = path.join(filesRoot, relativeName);
        ensureDir(path.dirname(backupPath));
        writeUtf8(backupPath, readUtf8(asset.path));
        manifest.entries.push({
            path: asset.path,
            type: asset.type,
            scope: asset.scope,
            backedUp: true,
            backupPath
        });
    }

    const manifestPath = path.join(backupRoot, 'manifest.json');
    writeJson(manifestPath, manifest);

    return {
        backupId,
        backupRoot,
        manifestPath,
        entryCount: manifest.entries.filter((entry) => entry.backedUp).length
    };
}

function restoreBackup(rootDir, backupId) {
    const backupRoot = path.join(rootDir, 'harness', 'state', 'backups', backupId);
    const manifestPath = path.join(backupRoot, 'manifest.json');
    if (!exists(manifestPath)) {
        throw new Error(`Backup manifest not found: ${manifestPath}`);
    }

    const manifest = JSON.parse(readUtf8(manifestPath));
    let restoredCount = 0;

    for (const entry of manifest.entries) {
        if (!entry.backedUp || !entry.backupPath) {
            continue;
        }
        writeUtf8(entry.path, readUtf8(entry.backupPath));
        restoredCount += 1;
    }

    return {
        backupId,
        restoredCount,
        manifestPath
    };
}

function listBackups(rootDir) {
    const backupsRoot = path.join(rootDir, 'harness', 'state', 'backups');
    if (!exists(backupsRoot)) {
        return [];
    }

    return fs.readdirSync(backupsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
}

function createBackupId(label) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${label || 'backup'}-${timestamp}`;
}

function sanitizeBackupPath(inputPath) {
    return inputPath
        .replace(/^[A-Za-z]:/, '')
        .replace(/[<>:"|?*]/g, '_')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
}

module.exports = {
    backupAssets,
    listBackups,
    restoreBackup
};
