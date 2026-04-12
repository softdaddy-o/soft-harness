const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
    copyPath,
    ensureDir,
    exists,
    formatOffsetDate,
    getMtime,
    isDirectory,
    isFile,
    kstTimestamp,
    readJson,
    readUtf8,
    removePath,
    toPosixRelative,
    walkFiles,
    writeJson,
    writeUtf8
} = require('../src/fs-util');
const { makeProjectTree, makeTempDir } = require('./helpers');

test('fs-util: ensureDir + writeUtf8 + readUtf8 roundtrip', () => {
    const dir = makeTempDir('soft-harness-fs-');
    const filePath = path.join(dir, 'nested', 'file.txt');
    ensureDir(path.dirname(filePath));
    writeUtf8(filePath, 'hello');
    assert.equal(exists(filePath), true);
    assert.equal(readUtf8(filePath), 'hello');
});

test('fs-util: writeJson/readJson roundtrip', () => {
    const dir = makeTempDir('soft-harness-json-');
    const filePath = path.join(dir, 'a.json');
    writeJson(filePath, { ok: true });
    assert.deepEqual(readJson(filePath), { ok: true });
    assert.equal(readJson(path.join(dir, 'missing.json'), { fallback: true }).fallback, true);
});

test('fs-util: kstTimestamp returns local timestamp shape', () => {
    assert.match(kstTimestamp(), /^\d{4}-\d{2}-\d{2}-\d{6}$/);
});

test('fs-util: formatOffsetDate includes timezone offset', () => {
    assert.match(formatOffsetDate(new Date('2026-04-13T10:11:12Z')), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test('fs-util: toPosixRelative uses forward slashes', () => {
    assert.equal(toPosixRelative('/root', '/root/sub/file.txt'), 'sub/file.txt');
});

test('fs-util: isFile, isDirectory, copyPath, removePath, getMtime, and walkFiles cover nested trees', () => {
    const root = makeProjectTree('soft-harness-fs-tree-', {
        source: {
            nested: {
                'file.txt': 'hello',
                'other.md': 'skip'
            }
        }
    });
    const sourceDir = path.join(root, 'source');
    const targetDir = path.join(root, 'target');
    const copiedFile = path.join(targetDir, 'nested', 'file.txt');

    assert.equal(isDirectory(sourceDir), true);
    assert.equal(isFile(path.join(sourceDir, 'nested', 'file.txt')), true);
    assert.equal(isFile(path.join(sourceDir, 'nested')), false);
    assert.equal(isDirectory(path.join(sourceDir, 'nested', 'file.txt')), false);

    copyPath(sourceDir, targetDir);
    assert.equal(readUtf8(copiedFile), 'hello');
    assert.ok(getMtime(copiedFile) > 0);
    assert.equal(getMtime(path.join(root, 'missing.txt')), 0);

    const walked = walkFiles(root, (relativePath) => relativePath.endsWith('.txt'));
    assert.deepEqual(walked.map((entry) => entry.relativePath).sort(), [
        'source/nested/file.txt',
        'target/nested/file.txt'
    ]);
    assert.deepEqual(walkFiles(path.join(root, 'missing-dir')), []);

    removePath(targetDir);
    assert.equal(exists(targetDir), false);
});

test('fs-util: removePath is safe for missing targets and ensureDir can prepare nested trees', () => {
    const root = makeTempDir('soft-harness-fs-missing-');
    const nestedDir = path.join(root, 'a', 'b', 'c');
    ensureDir(nestedDir);
    assert.equal(fs.existsSync(nestedDir), true);
    removePath(path.join(root, 'does-not-exist'));
});
