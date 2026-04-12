const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { createLink, isSymlink, readLink } = require('../src/symlink');
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
    assert.ok(readLink(targetPath));
});

test('symlink: createLink falls back to copy metadata when symlink creation fails', () => {
    const root = makeTempDir('soft-harness-symlink-fail-');
    const sourcePath = path.join(root, 'source', 'file.txt');
    const targetPath = path.join(root, 'target', 'file.txt');
    const original = fs.symlinkSync;
    writeUtf8(sourcePath, 'hello');

    fs.symlinkSync = () => {
        throw new Error('blocked');
    };
    try {
        const result = createLink(sourcePath, targetPath, { prefer: 'symlink' });
        assert.equal(result.mode, 'copy');
        assert.match(result.error, /blocked/);
        assert.equal(isSymlink(targetPath), false);
    } finally {
        fs.symlinkSync = original;
    }
});

test('symlink: junction preference retries with junction on win32 directory failures', () => {
    const root = makeTempDir('soft-harness-symlink-junction-');
    const sourcePath = path.join(root, 'source');
    const targetPath = path.join(root, 'target');
    fs.mkdirSync(sourcePath, { recursive: true });

    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const original = fs.symlinkSync;
    let calls = 0;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    fs.symlinkSync = (_source, _target, type) => {
        calls += 1;
        if (type === 'dir') {
            throw new Error('dir blocked');
        }
    };
    try {
        const result = createLink(sourcePath, targetPath, { prefer: 'junction' });
        assert.equal(result.mode, 'junction');
        assert.equal(calls, 2);
    } finally {
        fs.symlinkSync = original;
        Object.defineProperty(process, 'platform', originalPlatform);
    }
});

test('symlink: missing sources default to directory links and double-failure returns copy', () => {
    const root = makeTempDir('soft-harness-symlink-missing-');
    const sourcePath = path.join(root, 'missing-source');
    const targetPath = path.join(root, 'target');
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
    const original = fs.symlinkSync;
    Object.defineProperty(process, 'platform', { value: 'win32' });
    fs.symlinkSync = () => {
        throw new Error('still blocked');
    };
    try {
        const result = createLink(sourcePath, targetPath, { prefer: 'junction' });
        assert.equal(result.mode, 'copy');
        assert.match(result.error, /still blocked/);
    } finally {
        fs.symlinkSync = original;
        Object.defineProperty(process, 'platform', originalPlatform);
    }
});
