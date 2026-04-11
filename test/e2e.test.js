const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { listBackups } = require('../src/backup');
const { runRevert } = require('../src/revert');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { runSync } = require('../src/sync');
const { copyFixture } = require('./helpers');

test('e2e: sync, drift, and revert work on a mixed project', async () => {
    const root = copyFixture('e2e-mixed');
    const first = await runSync(root, {}, {});
    assert.equal(first.phase, 'completed');

    const backups = listBackups(root);
    assert.ok(backups.length >= 1);

    writeUtf8(path.join(root, 'CLAUDE.md'), 'broken');
    await runSync(root, {}, {});

    runRevert(root, { timestamp: backups[0].timestamp });
    assert.match(readUtf8(path.join(root, 'CLAUDE.md')), /# Project/);
});
