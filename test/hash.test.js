const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { hashDirectory, hashFile, hashString } = require('../src/hash');
const { makeTempDir } = require('./helpers');

test('hash: hashString is deterministic sha256', () => {
    assert.equal(hashString('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('hash: hashFile reads and hashes', () => {
    const dir = makeTempDir('soft-harness-hash-');
    const filePath = path.join(dir, 'x.txt');
    fs.writeFileSync(filePath, 'hello');
    assert.equal(hashFile(filePath), hashString('hello'));
});

test('hash: hashDirectory ignores marker files when asked', () => {
    const dir = makeTempDir('soft-harness-dirhash-');
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A');
    const before = hashDirectory(dir);
    fs.writeFileSync(path.join(dir, '.harness-managed'), 'meta');
    const after = hashDirectory(dir, { ignore: ['.harness-managed'] });
    assert.equal(before, after);
});
