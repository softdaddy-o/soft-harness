const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { ensureDir, exists, kstTimestamp, readJson, readUtf8, toPosixRelative, writeJson, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

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
});

test('fs-util: kstTimestamp returns local timestamp shape', () => {
    assert.match(kstTimestamp(), /^\d{4}-\d{2}-\d{2}-\d{6}$/);
});

test('fs-util: toPosixRelative uses forward slashes', () => {
    assert.equal(toPosixRelative('/root', '/root/sub/file.txt'), 'sub/file.txt');
});
