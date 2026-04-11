const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBackup, listBackups, restoreBackup } = require('../src/backup');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
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
