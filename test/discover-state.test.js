const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { discoverInstructions } = require('../src/discover');
const { loadState, saveState } = require('../src/state');
const { writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('discover: finds known instruction files and uses explicit classification callback', async () => {
    const root = makeTempDir('soft-harness-discover-');
    writeUtf8(path.join(root, 'CLAUDE.md'), '# Claude');
    writeUtf8(path.join(root, 'AGENTS.md'), '# Codex');

    const discovered = await discoverInstructions(root, {
        classifyAmbiguous(relativePath, matches) {
            return matches[0];
        }
    });

    assert.deepEqual(discovered.map((entry) => entry.relativePath).sort(), ['AGENTS.md', 'CLAUDE.md']);
    assert.deepEqual(discovered.map((entry) => entry.llm).sort(), ['claude', 'codex']);
});

test('state: saveState persists and loadState restores values', () => {
    const root = makeTempDir('soft-harness-state-');
    saveState(root, {
        classifications: {
            'AGENTS.md': 'codex'
        },
        assets: {
            instructions: [{ target: 'AGENTS.md', source: '.harness/llm/codex.md' }],
            skills: [],
            agents: []
        }
    });

    const loaded = loadState(root);
    assert.equal(loaded.classifications['AGENTS.md'], 'codex');
    assert.equal(loaded.assets.instructions.length, 1);
});
