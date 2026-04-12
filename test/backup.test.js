const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBackup, listBackups, restoreBackup } = require('../src/backup');
const { exists, readJson, readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

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
