const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBackup, listBackups, restoreBackup } = require('../src/backup');
const { ensureDir, exists, getMtime, readJson, readUtf8, removePath, walkFiles, writeJson, writeUtf8 } = require('../src/fs-util');
const { hashDirectory, hashFile } = require('../src/hash');
const { createMemoryFs } = require('./helpers');

test('vfs: fs-util supports tree writes, walk, copy-safe removal, and json roundtrip in memory', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('vfs-fs-util-root');
        const filePath = path.join(root, 'docs', 'note.md');
        const jsonPath = path.join(root, 'state', 'data.json');

        ensureDir(path.join(root, 'empty'));
        writeUtf8(filePath, '# Note');
        writeJson(jsonPath, { ok: true });

        assert.equal(exists(filePath), true);
        assert.equal(readUtf8(filePath), '# Note');
        assert.deepEqual(readJson(jsonPath), { ok: true });
        assert.ok(getMtime(filePath) > 0);
        assert.deepEqual(walkFiles(root).map((entry) => entry.relativePath), ['docs/note.md', 'state/data.json']);

        removePath(path.join(root, 'docs'));
        assert.equal(exists(filePath), false);
        removePath(path.join(root, 'missing'));
    });
});

test('vfs: hash helpers work against memory-backed files and directories', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('vfs-hash-root');
        memoryFs.writeTree(root, {
            alpha: {
                'one.txt': '1',
                'two.txt': '2'
            },
            beta: {
                '.harness-managed': 'meta'
            }
        });

        const fileHash = hashFile(path.join(root, 'alpha', 'one.txt'));
        const dirHash = hashDirectory(path.join(root, 'alpha'));
        const ignoredHash = hashDirectory(path.join(root, 'beta'), { ignore: ['.harness-managed'] });

        assert.equal(typeof fileHash, 'string');
        assert.equal(fileHash.length, 64);
        assert.equal(typeof dirHash, 'string');
        assert.equal(dirHash.length, 64);
        assert.equal(ignoredHash.length, 64);
    });
});

test('vfs: backup create/list/restore roundtrip file, directory, and missing entries in memory', () => {
    const memoryFs = createMemoryFs();
    return memoryFs.run(() => {
        const root = memoryFs.root('vfs-backup-root');
        memoryFs.writeTree(root, {
            '.harness': {
                'HARNESS.md': 'shared'
            },
            docs: {
                'guide.md': 'first'
            }
        });

        const backup = createBackup(root, ['docs', 'missing.txt'], { timestamp: '2026-04-13-120000', reason: 'test' });
        writeUtf8(path.join(root, 'docs', 'guide.md'), 'second');
        removePath(path.join(root, 'docs'));

        const backups = listBackups(root);
        assert.deepEqual(backups, [{ timestamp: '2026-04-13-120000', fileCount: 2, reason: 'test' }]);

        const restored = restoreBackup(root, backup.timestamp);
        assert.equal(restored.restoredCount, 2);
        assert.equal(readUtf8(path.join(root, 'docs', 'guide.md')), 'first');
        assert.equal(exists(path.join(root, 'missing.txt')), false);
        assert.deepEqual(readJson(path.join(root, '.harness', 'backups', '2026-04-13-120000', 'manifest.json')).entries.map((entry) => entry.kind), ['directory', 'missing']);
    });
});
