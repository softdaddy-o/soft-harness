const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

test('cli: help lists sync and revert', () => {
    const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /soft-harness sync/);
    assert.match(result.stdout, /soft-harness revert/);
});

test('cli: unknown command exits non-zero', () => {
    const result = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/i);
});
