const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBackup, listBackups, restoreBackup } = require('../src/backup');
const { copyPath, exists, readJson, readUtf8, writeJson, writeUtf8 } = require('../src/fs-util');
const { createMemoryFs, makeTempDir } = require('./helpers');

test('backup: createBackup and restoreBackup roundtrip a file', () => {
    const root = makeTempDir('soft-harness-backup-');
    writeUtf8(path.join(root, 'AGENTS.md'), 'before');
    const backup = createBackup(root, ['AGENTS.md'], { timestamp: '2026-04-10-100000', reason: 'test' });
    writeUtf8(path.join(root, 'AGENTS.md'), 'after');

    const restored = restoreBackup(root, backup.timestamp);
    assert.equal(restored.restoredCount, 1);
    assert.equal(readUtf8(path.join(root, 'AGENTS.md')), 'before');

    const listed = listBackups(root);
    assert.ok(listed.some((entry) => entry.timestamp === '2026-04-10-100000'));
});

test('backup: missing file entries restore by deleting current file', () => {
    const root = makeTempDir('soft-harness-backup-missing-');
    const backup = createBackup(root, ['CLAUDE.md'], { timestamp: '2026-04-10-100001', reason: 'test' });
    writeUtf8(path.join(root, 'CLAUDE.md'), 'created later');
    restoreBackup(root, backup.timestamp);
    assert.equal(exists(path.join(root, 'CLAUDE.md')), false);
});

test('backup: external file entries restore and preserve the pre-restore external state', () => {
    const root = makeTempDir('soft-harness-backup-external-root-');
    const externalRoot = makeTempDir('soft-harness-backup-external-file-');
    const externalPath = path.join(externalRoot, 'MEMORY.md');
    writeUtf8(externalPath, 'before partition');

    const backup = createBackup(root, ['AGENTS.md'], { timestamp: '2026-04-10-external', reason: 'partition-memory' });
    const backupPath = path.join('external', 'memory', 'MEMORY.md');
    fs.mkdirSync(path.join(backup.backupDir, 'external', 'memory'), { recursive: true });
    fs.copyFileSync(externalPath, path.join(backup.backupDir, backupPath));

    const manifestPath = path.join(root, '.harness', 'backups', backup.timestamp, 'manifest.json');
    const manifest = readJson(manifestPath);
    manifest.entries.push({
        path: `external:${externalPath}`,
        kind: 'external-file',
        originalPath: externalPath,
        backupPath
    });
    writeJson(manifestPath, manifest);

    writeUtf8(externalPath, 'after partition');
    restoreBackup(root, backup.timestamp);

    assert.equal(readUtf8(externalPath), 'before partition');

    const revertBackup = listBackups(root).find((entry) => entry.reason === `revert:${backup.timestamp}`);
    assert.ok(revertBackup);
    const revertManifest = readJson(path.join(root, '.harness', 'backups', revertBackup.timestamp, 'manifest.json'));
    const externalEntry = revertManifest.entries.find((entry) => entry.kind === 'external-file');
    assert.equal(externalEntry.originalPath, externalPath);
    assert.match(readUtf8(path.join(root, '.harness', 'backups', revertBackup.timestamp, externalEntry.backupPath)), /after partition/);
});

test('backup: symlink entries restore as symlinks when supported', { skip: process.platform === 'win32' ? false : false }, () => {
    const root = makeTempDir('soft-harness-backup-link-');
    writeUtf8(path.join(root, 'source', 'file.txt'), 'hello');

    try {
        require('node:fs').symlinkSync(path.join(root, 'source'), path.join(root, 'linked'), 'junction');
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            return;
        }
        throw error;
    }

    const backup = createBackup(root, ['linked'], { timestamp: '2026-04-11-restore-link', reason: 'test' });
    require('node:fs').rmSync(path.join(root, 'linked'), { recursive: true, force: true });
    restoreBackup(root, backup.timestamp);

    assert.equal(require('node:fs').lstatSync(path.join(root, 'linked')).isSymbolicLink(), true);
});

test('backup: nested junctions are preserved while copying a parent directory', (context) => {
    const root = makeTempDir('soft-harness-backup-nested-link-');
    const hostDir = path.join(root, 'host');
    const sharedDir = path.join(root, 'shared-references');
    const nestedLink = path.join(hostDir, 'skill', 'references');
    writeUtf8(path.join(sharedDir, 'guide.md'), '# Shared');
    fs.mkdirSync(path.dirname(nestedLink), { recursive: true });

    try {
        fs.symlinkSync(sharedDir, nestedLink, 'junction');
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            return context.skip(`junctions unavailable: ${error.code}`);
        }
        throw error;
    }

    const backup = createBackup(root, ['host'], { timestamp: '2026-08-23-nested-link', reason: 'test' });
    fs.rmSync(hostDir, { recursive: true, force: true });
    restoreBackup(root, backup.timestamp);

    assert.equal(fs.lstatSync(nestedLink).isSymbolicLink(), true);
    assert.equal(readUtf8(path.join(nestedLink, 'guide.md')), '# Shared');
});

test('backup: copying a link replaces a dangling link target', (context) => {
    const root = makeTempDir('soft-harness-backup-replace-link-');
    const sourceDir = path.join(root, 'source');
    const sourceLink = path.join(root, 'source-link');
    const targetLink = path.join(root, 'target-link');
    writeUtf8(path.join(sourceDir, 'guide.md'), '# Source');

    try {
        fs.symlinkSync(sourceDir, sourceLink, 'junction');
        fs.symlinkSync(path.join(root, 'missing'), targetLink, 'junction');
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') {
            return context.skip(`junctions unavailable: ${error.code}`);
        }
        throw error;
    }

    copyPath(sourceLink, targetLink);

    assert.equal(fs.lstatSync(targetLink).isSymbolicLink(), true);
    assert.equal(readUtf8(path.join(targetLink, 'guide.md')), '# Source');
});

test('backup: directory copies reject a destination nested inside the source', () => {
    const root = makeTempDir('soft-harness-backup-self-copy-');
    const sourceDir = path.join(root, 'source');
    writeUtf8(path.join(sourceDir, 'guide.md'), '# Source');

    assert.throws(
        () => copyPath(sourceDir, path.join(sourceDir, '..copy')),
        (error) => error.code === 'ERR_FS_CP_EINVAL'
    );
});

test('backup: directory copies reject destinations aliased inside the source', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-backup-aliased-self-copy-root');
        const sourceDir = path.join(root, 'source');
        const aliasLink = path.join(root, 'alias');
        writeUtf8(path.join(sourceDir, 'guide.md'), '# Source');
        memoryFs.backend.symlinkSync(sourceDir, aliasLink, 'junction');

        assert.throws(
            () => copyPath(sourceDir, path.join(aliasLink, 'copy')),
            (error) => error.code === 'ERR_FS_CP_EINVAL'
        );
    });
});

test('backup: copying a link does not delete its referent inside the destination', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-backup-contained-link-root');
        const targetDir = path.join(root, 'target');
        const aliasLink = path.join(root, 'alias-link');
        const sourceLink = path.join(root, 'source-link');
        const referent = path.join(targetDir, '..inside');
        writeUtf8(path.join(referent, 'data.txt'), 'keep');
        memoryFs.backend.symlinkSync(referent, aliasLink, 'junction');
        memoryFs.backend.symlinkSync(aliasLink, sourceLink, 'junction');

        assert.throws(
            () => copyPath(sourceLink, targetDir),
            (error) => error.code === 'EEXIST'
        );
        assert.equal(readUtf8(path.join(referent, 'data.txt')), 'keep');
    });
});

test('backup: ordinary file copies replace destination symlinks', () => {
    const memoryFs = createMemoryFs();
    const originalCopyFileSync = memoryFs.backend.copyFileSync;
    memoryFs.backend.copyFileSync = (sourcePath, targetPath) => {
        let targetStats = null;
        try {
            targetStats = memoryFs.backend.lstatSync(targetPath);
        } catch (error) {
            if (!String(error.message).startsWith('ENOENT:')) {
                throw error;
            }
        }
        if (targetStats && targetStats.isSymbolicLink()) {
            const rawTarget = memoryFs.backend.readlinkSync(targetPath);
            const resolvedTarget = path.isAbsolute(rawTarget)
                ? rawTarget
                : path.resolve(path.dirname(targetPath), rawTarget);
            originalCopyFileSync(sourcePath, resolvedTarget);
            return;
        }
        originalCopyFileSync(sourcePath, targetPath);
    };

    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-backup-file-over-link-root');
        const sourceFile = path.join(root, 'source.txt');
        const referentFile = path.join(root, 'referent.txt');
        const targetLink = path.join(root, 'target.txt');
        writeUtf8(sourceFile, 'new');
        writeUtf8(referentFile, 'keep');
        memoryFs.backend.symlinkSync(referentFile, targetLink, 'file');

        copyPath(sourceFile, targetLink);

        assert.equal(memoryFs.backend.lstatSync(targetLink).isFile(), true);
        assert.equal(readUtf8(targetLink), 'new');
        assert.equal(readUtf8(referentFile), 'keep');
    });
});

test('backup: ordinary file and directory copies preserve source modes', () => {
    const root = makeTempDir('soft-harness-backup-copy-mode-');
    const sourceDir = path.join(root, 'source-dir');
    const sourceFile = path.join(root, 'source.txt');
    const targetDir = path.join(root, 'target-dir');
    const targetFile = path.join(root, 'target.txt');
    fs.mkdirSync(sourceDir, { recursive: true });
    writeUtf8(sourceFile, 'source');
    writeUtf8(targetFile, 'stale');
    fs.chmodSync(sourceDir, 0o555);
    fs.chmodSync(sourceFile, 0o444);
    fs.chmodSync(targetFile, 0o666);

    copyPath(sourceDir, targetDir);
    copyPath(sourceFile, targetFile);

    assert.equal(fs.statSync(targetDir).mode & 0o777, fs.statSync(sourceDir).mode & 0o777);
    assert.equal(fs.statSync(targetFile).mode & 0o777, fs.statSync(sourceFile).mode & 0o777);
});

test('backup: nested relative links keep their source resolution and replace existing targets', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('soft-harness-backup-relative-link-root');
        const hostDir = path.join(root, 'host');
        const sharedDir = path.join(root, 'shared-references');
        const relativeLink = path.join(hostDir, 'skill', 'relative-references');
        const existingTarget = path.join(root, 'existing-target');
        writeUtf8(path.join(sharedDir, 'guide.md'), '# Shared');
        memoryFs.backend.symlinkSync('../../shared-references', relativeLink, 'junction');

        const backup = createBackup(root, ['host'], { timestamp: '2026-08-23-relative-link', reason: 'test' });
        const copiedRelative = path.join(backup.backupDir, 'host', 'skill', 'relative-references');
        assert.equal(memoryFs.backend.lstatSync(copiedRelative).isSymbolicLink(), true);
        assert.equal(
            path.resolve(path.dirname(copiedRelative), memoryFs.backend.readlinkSync(copiedRelative)),
            sharedDir
        );

        writeUtf8(existingTarget, 'stale');
        copyPath(relativeLink, existingTarget);
        assert.equal(memoryFs.backend.lstatSync(existingTarget).isSymbolicLink(), true);
        assert.equal(memoryFs.backend.readlinkSync(existingTarget), sharedDir);

        memoryFs.backend.rmSync(hostDir, { recursive: true, force: true });
        restoreBackup(root, backup.timestamp);
        assert.equal(memoryFs.backend.lstatSync(relativeLink).isSymbolicLink(), true);
        assert.equal(memoryFs.backend.readlinkSync(relativeLink), sharedDir);
    });
});

test('backup: createBackup returns null for empty paths and listBackups is empty without backup dir', () => {
    const root = makeTempDir('soft-harness-backup-empty-');
    assert.equal(createBackup(root, []), null);
    assert.deepEqual(listBackups(root), []);
});

test('backup: createBackup increments timestamps when collisions exist', () => {
    const root = makeTempDir('soft-harness-backup-collision-');
    writeUtf8(path.join(root, 'file.txt'), 'hello');
    createBackup(root, ['file.txt'], { timestamp: '2026-04-13-120000' });
    createBackup(root, ['file.txt'], { timestamp: '2026-04-13-120000' });
    const third = createBackup(root, ['file.txt'], { timestamp: '2026-04-13-120000' });

    assert.equal(third.timestamp, '2026-04-13-120000-2');
});

test('backup: inferLinkType falls back to junction when stat fails', () => {
    const root = makeTempDir('soft-harness-backup-linktype-');
    const sourceDir = path.join(root, 'source');
    const linkPath = path.join(root, 'linked-dir');
    fs.mkdirSync(sourceDir, { recursive: true });
    try {
        fs.symlinkSync(sourceDir, linkPath, 'junction');
    } catch (error) {
        return;
    }

    const originalStatSync = fs.statSync;
    fs.statSync = () => {
        throw new Error('broken link');
    };
    try {
        const backup = createBackup(root, ['linked-dir'], { timestamp: '2026-04-13-130000' });
        const manifest = readJson(path.join(root, '.harness', 'backups', backup.timestamp, 'manifest.json'));
        assert.equal(manifest.entries[0].linkType, 'junction');
    } finally {
        fs.statSync = originalStatSync;
    }
});
