const test = require('node:test');
const assert = require('node:assert/strict');
const { getProfile, listProfiles, matchInstructionFile } = require('../src/profiles');

test('profiles: listProfiles returns claude, codex, gemini', () => {
    assert.deepEqual(listProfiles().sort(), ['claude', 'codex', 'gemini']);
});

test('profiles: getProfile returns full profile object', () => {
    const claude = getProfile('claude');
    assert.equal(claude.name, 'claude');
    assert.equal(claude.supports_imports, true);
    assert.deepEqual(claude.instruction_files, ['CLAUDE.md', '.claude/CLAUDE.md']);
});

test('profiles: matchInstructionFile identifies exact matches', () => {
    assert.deepEqual(matchInstructionFile('CLAUDE.md'), ['claude']);
    assert.deepEqual(matchInstructionFile('.claude/CLAUDE.md'), ['claude']);
    assert.deepEqual(matchInstructionFile('AGENTS.md'), ['codex']);
    assert.deepEqual(matchInstructionFile('GEMINI.md'), ['gemini']);
});
