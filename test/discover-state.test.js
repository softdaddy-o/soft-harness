const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { discoverInstructions } = require('../src/discover');
const { loadState, saveState } = require('../src/state');
const { formatOffsetDate, writeUtf8 } = require('../src/fs-util');
const { loadFresh, makeTempDir } = require('./helpers');

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

test('state: loadState returns merged defaults when no state file exists or partial state is saved', () => {
    const root = makeTempDir('soft-harness-state-defaults-');
    const missing = loadState(root);
    assert.deepEqual(missing.assets, {
        instructions: [],
        skills: [],
        agents: []
    });
    assert.deepEqual(missing.classifications, {});

    const timestamp = new Date('2026-04-13T10:00:00+09:00');
    saveState(root, { assets: { instructions: [{ target: 'CLAUDE.md' }] } }, timestamp);
    const loaded = loadState(root);
    assert.equal(loaded.assets.instructions.length, 1);
    assert.deepEqual(loaded.assets.skills, []);
    assert.deepEqual(loaded.assets.agents, []);
    assert.equal(loaded.synced_at, formatOffsetDate(timestamp));
});

test('state: saveState without explicit input still writes defaults and a timestamp', () => {
    const root = makeTempDir('soft-harness-state-save-defaults-');
    const saved = saveState(root);
    assert.equal(saved.version, 1);
    assert.ok(saved.synced_at);

    const loaded = loadState(root);
    assert.deepEqual(loaded.plugins, []);
    assert.deepEqual(loaded.classifications, {});
});

test('discover: honors saved classifications and can skip unmatched files', async () => {
    const profiles = require('../src/profiles');
    const original = profiles.matchInstructionFile;
    profiles.matchInstructionFile = (relativePath) => {
        if (relativePath === 'CLAUDE.md') {
            return [];
        }
        if (relativePath === 'GEMINI.md') {
            return ['gemini', 'claude'];
        }
        return original(relativePath);
    };

    try {
        const { discoverInstructions: discoverFresh } = loadFresh('../src/discover');
        const root = makeTempDir('soft-harness-discover-stateful-');
        writeUtf8(path.join(root, 'CLAUDE.md'), '# Claude');
        writeUtf8(path.join(root, 'GEMINI.md'), '# Gemini');

        const discovered = await discoverFresh(root, {
            state: {
                classifications: {
                    'GEMINI.md': 'gemini'
                }
            }
        });

        assert.deepEqual(discovered.map((entry) => entry.relativePath), ['GEMINI.md']);
        assert.equal(discovered[0].llm, 'gemini');
    } finally {
        profiles.matchInstructionFile = original;
        delete require.cache[require.resolve('../src/discover')];
    }
});

test('discover: ambiguous matches can use an explicit classifier callback', async () => {
    const profiles = require('../src/profiles');
    const original = profiles.matchInstructionFile;
    profiles.matchInstructionFile = (relativePath) => relativePath === 'GEMINI.md' ? ['gemini', 'claude'] : original(relativePath);

    try {
        const { discoverInstructions: discoverFresh } = loadFresh('../src/discover');
        const root = makeTempDir('soft-harness-discover-ambiguous-');
        writeUtf8(path.join(root, 'GEMINI.md'), '# Gemini');

        const discovered = await discoverFresh(root, {
            classifyAmbiguous(relativePath, matches) {
                assert.equal(relativePath, 'GEMINI.md');
                assert.deepEqual(matches, ['gemini', 'claude']);
                return 'claude';
            }
        });

        assert.equal(discovered[0].llm, 'claude');
    } finally {
        profiles.matchInstructionFile = original;
        delete require.cache[require.resolve('../src/discover')];
    }
});
