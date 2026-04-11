const fs = require('node:fs');
const path = require('node:path');
const { copyPath, ensureDir, exists, kstTimestamp, readJson, removePath, writeJson } = require('./fs-util');
const { getHarnessDir } = require('./state');

function getBackupsDir(rootDir) {
    return path.join(getHarnessDir(rootDir), 'backups');
}

function getBackupDir(rootDir, timestamp) {
    return path.join(getBackupsDir(rootDir), timestamp);
}

function normalizeBackupPaths(paths) {
    return Array.from(new Set((paths || []).filter(Boolean))).sort();
}

function createBackup(rootDir, paths, options) {
    const uniquePaths = normalizeBackupPaths(paths);
    if (uniquePaths.length === 0) {
        return null;
    }

    const timestamp = getAvailableTimestamp(rootDir, (options && options.timestamp) || kstTimestamp());
    const backupDir = getBackupDir(rootDir, timestamp);
    ensureDir(backupDir);

    const entries = [];
    for (const relativePath of uniquePaths) {
        const absolutePath = path.join(rootDir, relativePath);
        if (!exists(absolutePath)) {
            entries.push({
                path: relativePath,
                kind: 'missing'
            });
            continue;
        }

        const stats = fs.lstatSync(absolutePath);
        if (stats.isSymbolicLink()) {
            entries.push({
                path: relativePath,
                kind: 'symlink',
                linkTarget: fs.readlinkSync(absolutePath),
                linkType: inferLinkType(absolutePath)
            });
            continue;
        }

        const kind = stats.isDirectory() ? 'directory' : 'file';
        entries.push({
            path: relativePath,
            kind
        });
        copyPath(absolutePath, path.join(backupDir, relativePath));
    }

    const manifest = {
        timestamp,
        reason: options && options.reason,
        created_at: new Date().toString(),
        entries
    };
    writeJson(path.join(backupDir, 'manifest.json'), manifest);

    return {
        timestamp,
        backupDir,
        manifestPath: path.join(backupDir, 'manifest.json'),
        entryCount: entries.length
    };
}

function getAvailableTimestamp(rootDir, baseTimestamp) {
    if (!exists(getBackupDir(rootDir, baseTimestamp))) {
        return baseTimestamp;
    }

    let counter = 1;
    while (exists(getBackupDir(rootDir, `${baseTimestamp}-${counter}`))) {
        counter += 1;
    }
    return `${baseTimestamp}-${counter}`;
}

function readManifest(rootDir, timestamp) {
    const manifestPath = path.join(getBackupDir(rootDir, timestamp), 'manifest.json');
    if (!exists(manifestPath)) {
        throw new Error(`backup not found: ${timestamp}`);
    }
    return readJson(manifestPath);
}

function listBackups(rootDir) {
    const backupsDir = getBackupsDir(rootDir);
    if (!exists(backupsDir)) {
        return [];
    }

    return fs.readdirSync(backupsDir)
        .filter((entry) => exists(path.join(backupsDir, entry, 'manifest.json')))
        .sort()
        .map((timestamp) => {
            const manifest = readManifest(rootDir, timestamp);
            return {
                timestamp,
                fileCount: manifest.entries.length,
                reason: manifest.reason
            };
        });
}

function restoreBackup(rootDir, timestamp) {
    const manifest = readManifest(rootDir, timestamp);
    createBackup(
        rootDir,
        manifest.entries.map((entry) => entry.path),
        { reason: `revert:${timestamp}` }
    );

    const backupDir = getBackupDir(rootDir, timestamp);
    for (const entry of manifest.entries) {
        const targetPath = path.join(rootDir, entry.path);
        if (entry.kind === 'missing') {
            removePath(targetPath);
            continue;
        }

        if (entry.kind === 'symlink') {
            removePath(targetPath);
            ensureDir(path.dirname(targetPath));
            fs.symlinkSync(entry.linkTarget, targetPath, entry.linkType || 'junction');
            continue;
        }

        removePath(targetPath);
        copyPath(path.join(backupDir, entry.path), targetPath);
    }

    return {
        timestamp,
        restoredCount: manifest.entries.length
    };
}

function inferLinkType(absolutePath) {
    try {
        const stats = fs.statSync(absolutePath);
        return stats.isDirectory() ? 'junction' : 'file';
    } catch (error) {
        return 'junction';
    }
}

module.exports = {
    createBackup,
    listBackups,
    restoreBackup
};
