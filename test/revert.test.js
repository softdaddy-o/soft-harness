const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBackup } = require('../src/backup');
const { runRevert } = require('../src/revert');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('revert: runRevert requires a timestamp and restores a backup', () => {
    const root = makeTempDir('soft-harness-revert-');
    writeUtf8(path.join(root, 'CLAUDE.md'), 'before');
    const backup = createBackup(root, ['CLAUDE.md'], { timestamp: '2026-04-13-150000' });
    writeUtf8(path.join(root, 'CLAUDE.md'), 'after');

    assert.throws(() => runRevert(root, {}), /timestamp is required/i);
    const result = runRevert(root, { timestamp: backup.timestamp });
    assert.equal(result.timestamp, backup.timestamp);
    assert.equal(readUtf8(path.join(root, 'CLAUDE.md')), 'before');
});
