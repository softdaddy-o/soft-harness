const path = require('node:path');
const { getFsBackend } = require('./fs-backend');
const { copyPath, ensureDir, exists, kstTimestamp, readJson, removePath, writeJson } = require('./fs-util');
const { hashString } = require('./hash');
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
    const warnings = [];
    for (const relativePath of uniquePaths) {
        const absolutePath = path.join(rootDir, relativePath);
        if (!exists(absolutePath)) {
            entries.push({
                path: relativePath,
                kind: 'missing'
            });
            continue;
        }

        const stats = getFsBackend().lstatSync(absolutePath);
        if (stats.isSymbolicLink()) {
            entries.push({
                path: relativePath,
                kind: 'symlink',
                linkTarget: getFsBackend().readlinkSync(absolutePath),
                linkType: inferLinkType(absolutePath)
            });
            continue;
        }

        const kind = stats.isDirectory() ? 'directory' : 'file';
        // One unreadable asset must not abort the run. A nested symlink used to
        // do exactly that on Windows: recreating it needs Developer Mode or
        // elevation, and the EPERM took down an otherwise unrelated sync.
        try {
            copyPath(absolutePath, path.join(backupDir, relativePath), { dereferenceLinks: true });
        } catch (error) {
            entries.push({
                path: relativePath,
                kind: 'skipped',
                error: error.message
            });
            warnings.push({
                path: relativePath,
                reason: `backup skipped: ${error.message}`
            });
            continue;
        }

        entries.push({
            path: relativePath,
            kind
        });
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
        entryCount: entries.length,
        warnings
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

    return getFsBackend().readdirSync(backupsDir)
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
    createRestoreBackup(rootDir, manifest, timestamp);

    const backupDir = getBackupDir(rootDir, timestamp);
    for (const entry of manifest.entries) {
        if (entry.kind === 'external-file') {
            copyPath(path.join(backupDir, entry.backupPath), entry.originalPath);
            continue;
        }
        if (entry.kind === 'external-missing') {
            removePath(entry.originalPath);
            continue;
        }

        const targetPath = path.join(rootDir, entry.path);
        if (entry.kind === 'missing') {
            removePath(targetPath);
            continue;
        }

        // Nothing was captured for this path, so there is nothing to restore.
        // Leaving it untouched is right -- removing it first, as the copy path
        // below does, would destroy the live file we failed to back up.
        if (entry.kind === 'skipped') {
            continue;
        }

        if (entry.kind === 'symlink') {
            removePath(targetPath);
            ensureDir(path.dirname(targetPath));
            getFsBackend().symlinkSync(entry.linkTarget, targetPath, entry.linkType || 'junction');
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

function createRestoreBackup(rootDir, manifest, timestamp) {
    const internalPaths = manifest.entries
        .filter((entry) => entry.kind !== 'external-file' && entry.kind !== 'external-missing')
        .map((entry) => entry.path);
    const externalEntries = manifest.entries
        .filter((entry) => entry.kind === 'external-file' || entry.kind === 'external-missing');

    let backup = createBackup(rootDir, internalPaths, { reason: `revert:${timestamp}` });
    if (!backup && externalEntries.length > 0) {
        backup = createEmptyBackup(rootDir, { reason: `revert:${timestamp}` });
    }
    if (backup && externalEntries.length > 0) {
        appendExternalCurrentBackups(backup, externalEntries);
    }
    return backup;
}

function createEmptyBackup(rootDir, options) {
    const timestamp = getAvailableTimestamp(rootDir, (options && options.timestamp) || kstTimestamp());
    const backupDir = getBackupDir(rootDir, timestamp);
    const manifestPath = path.join(backupDir, 'manifest.json');
    ensureDir(backupDir);
    writeJson(manifestPath, {
        timestamp,
        reason: options && options.reason,
        created_at: new Date().toString(),
        entries: []
    });
    return {
        timestamp,
        backupDir,
        manifestPath,
        entryCount: 0
    };
}

function appendExternalCurrentBackups(backup, entries) {
    const manifest = readJson(backup.manifestPath);
    for (const entry of entries) {
        const originalPath = entry.originalPath;
        const backupPath = normalizeBackupPath(path.join(
            'external',
            hashString(originalPath).slice(0, 12),
            path.basename(originalPath)
        ));
        if (!exists(originalPath)) {
            manifest.entries.push({
                path: `external:${originalPath}`,
                kind: 'external-missing',
                originalPath
            });
            continue;
        }

        copyPath(originalPath, path.join(backup.backupDir, backupPath));
        manifest.entries.push({
            path: `external:${originalPath}`,
            kind: 'external-file',
            originalPath,
            backupPath
        });
    }
    writeJson(backup.manifestPath, manifest);
    backup.entryCount = manifest.entries.length;
}

function normalizeBackupPath(value) {
    return String(value || '').replace(/\\/gu, '/');
}

function inferLinkType(absolutePath) {
    try {
        const stats = getFsBackend().statSync(absolutePath);
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
