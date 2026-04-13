const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { detectInstructionDrift } = require('../src/drift');
const { buildInstructionState, getCurrentSourceHash } = require('../src/export');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('drift: missing managed instruction targets are skipped safely', () => {
    const root = makeTempDir('soft-harness-drift-missing-');
    writeUtf8(path.join(root, '.harness', 'HARNESS.md'), '## Shared\nsame');
    const drift = detectInstructionDrift(root, {
        state: {
            assets: {
                instructions: [
                    { llm: 'codex', target: 'AGENTS.md' }
                ]
            }
        }
    });

    assert.deepEqual(drift, []);
});

test('export: buildInstructionState records source and target hashes for regenerated instructions', () => {
    const root = makeTempDir('soft-harness-export-state-');
    writeUtf8(path.join(root, '.harness', 'HARNESS.md'), '## Shared\nsame');
    writeUtf8(path.join(root, '.harness', 'llm', 'codex.md'), '## Codex\nonly');
    writeUtf8(path.join(root, 'AGENTS.md'), 'stale');

    const instructions = buildInstructionState(root, { assets: { instructions: [] } });
    const codex = instructions.find((entry) => entry.target === 'AGENTS.md');

    assert.ok(codex);
    assert.equal(codex.source, '.harness/llm/codex.md');
    assert.equal(codex.source_hash, getCurrentSourceHash(root, 'codex'));
    assert.notEqual(codex.target_hash, '');
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), /Codex/);
});
