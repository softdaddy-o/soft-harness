const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { createLink, isSymlink } = require('../src/symlink');
const { makeTempDir } = require('./helpers');

test('symlink: prefer copy returns copy without creating a link', () => {
    const root = makeTempDir('soft-harness-symlink-copy-');
    const sourcePath = path.join(root, 'source', 'file.txt');
    const targetPath = path.join(root, 'target', 'file.txt');

    writeUtf8(sourcePath, 'hello');
    const result = createLink(sourcePath, targetPath, { prefer: 'copy' });

    assert.equal(result.mode, 'copy');
    assert.equal(exists(targetPath), false);
});

test('symlink: explicit symlink mode creates a readable target when supported', () => {
    const root = makeTempDir('soft-harness-symlink-link-');
    const sourcePath = path.join(root, 'source', 'file.txt');
    const targetPath = path.join(root, 'target', 'file.txt');

    writeUtf8(sourcePath, 'hello');
    const result = createLink(sourcePath, targetPath, { prefer: 'symlink' });

    if (result.mode === 'copy') {
        return;
    }

    assert.equal(isSymlink(targetPath), true);
    assert.equal(readUtf8(targetPath), 'hello');
});
