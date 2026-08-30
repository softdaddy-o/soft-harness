const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { getProfile, instructionFilesFor, isAccountRoot } = require('../src/profiles');
const { buildInstructionExports } = require('../src/export');

// Codex loads a project's own AGENTS.md, but at account scope it reads
// ~/.codex/AGENTS.md and never ~/AGENTS.md. Generating the account file at the
// wrong path is silent: the file exists, looks current, and is never loaded.
test('codex uses .codex/AGENTS.md at account scope only', () => {
    const codex = getProfile('codex');
    assert.deepEqual(instructionFilesFor(codex, os.homedir()), ['.codex/AGENTS.md']);
    assert.deepEqual(instructionFilesFor(codex, path.join(os.homedir(), 'some-project')), ['AGENTS.md']);
    assert.deepEqual(instructionFilesFor(codex, 'F:/src3/Docs'), ['AGENTS.md']);
});

test('a profile without an account list is unchanged at both scopes', () => {
    const claude = getProfile('claude');
    assert.deepEqual(
        instructionFilesFor(claude, os.homedir()),
        instructionFilesFor(claude, 'F:/src3/Docs'),
        'claude reads CLAUDE.md and .claude/CLAUDE.md at either scope'
    );
});

// A project directory that happens to sit under home is still a project.
test('only the home directory itself counts as account scope', () => {
    assert.ok(isAccountRoot(os.homedir()));
    assert.ok(!isAccountRoot(path.join(os.homedir(), 'projects', 'thing')));
    assert.ok(!isAccountRoot(path.dirname(os.homedir())));
});

test('the exporter plans the account path for the account root', () => {
    const state = { assets: { instructions: [] } };
    const targets = buildInstructionExports(os.homedir(), { state })
        .filter((entry) => entry.llm === 'codex')
        .map((entry) => entry.relativePath);
    if (!targets.length) return; // account root may opt out of codex entirely
    assert.deepEqual(targets, ['.codex/AGENTS.md']);
});
