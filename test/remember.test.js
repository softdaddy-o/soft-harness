const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exists, readUtf8 } = require('../src/fs-util');
const { loadState } = require('../src/state');
const {
    DEFAULT_SECTION,
    parseRememberArgs,
    resolveRememberRoot,
    resolveRememberTarget,
    runRemember,
    upsertMemoryEntry
} = require('../src/remember');
const { makeProjectTree, makeTempDir } = require('./helpers');

test('remember: parseRememberArgs validates flags and defaults', () => {
    const parsed = parseRememberArgs([
        '--scope=account',
        '--llm=claude',
        '--section=Working Agreements',
        '--title=Timezone',
        '--content=Always use KST',
        '--no-export'
    ]);

    assert.deepEqual(parsed, {
        content: 'Always use KST',
        llm: 'claude',
        noExport: true,
        scope: 'account',
        section: 'Working Agreements',
        title: 'Timezone'
    });

    assert.throws(() => parseRememberArgs(['--scope=bogus', '--title=x', '--content=y']), /invalid --scope/i);
    assert.throws(() => parseRememberArgs(['--llm=bogus', '--title=x', '--content=y']), /unknown --llm target/i);
    assert.throws(() => parseRememberArgs(['--content=y']), /requires --title/i);
    assert.throws(() => parseRememberArgs(['--title=x']), /requires --content/i);
});

test('remember: resolveRememberRoot uses project cwd or account home', () => {
    const root = makeTempDir('soft-harness-remember-root-');
    const home = makeTempDir('soft-harness-remember-home-');
    const originalUserProfile = process.env.USERPROFILE;
    const originalHome = process.env.HOME;

    assert.equal(resolveRememberRoot(root, { scope: 'project' }), root);
    assert.equal(resolveRememberRoot(root, { scope: 'account', homeDir: home }), home);
    delete process.env.USERPROFILE;
    delete process.env.HOME;
    try {
        assert.throws(() => resolveRememberRoot(root, { scope: 'account', homeDir: '' }), /HOME or USERPROFILE/i);
    } finally {
        process.env.USERPROFILE = originalUserProfile;
        process.env.HOME = originalHome;
    }
});

test('remember: resolveRememberTarget maps shared and llm-specific outputs', () => {
    assert.deepEqual(resolveRememberTarget('shared'), {
        source: '.harness/memory/shared.md',
        outputs: ['CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md', 'GEMINI.md']
    });
    assert.deepEqual(resolveRememberTarget('codex'), {
        source: '.harness/memory/llm/codex.md',
        outputs: ['AGENTS.md']
    });
});

test('remember: upsertMemoryEntry creates sections and updates matching titles', () => {
    const created = upsertMemoryEntry('', {
        section: DEFAULT_SECTION,
        title: 'Timezone',
        content: 'Always use KST'
    });
    assert.match(created, /## Recorded Memory/);
    assert.match(created, /### Timezone/);
    assert.match(created, /Always use KST/);

    const updated = upsertMemoryEntry([
        '## Recorded Memory',
        '',
        '### Timezone',
        '',
        'Old value',
        '',
        '### Style',
        '',
        'Keep this'
    ].join('\n'), {
        section: DEFAULT_SECTION,
        title: 'Timezone',
        content: 'New value'
    });
    assert.doesNotMatch(updated, /Old value/);
    assert.match(updated, /New value/);
    assert.match(updated, /### Style/);

    const appendedSection = upsertMemoryEntry([
        '## Existing',
        '',
        '### Note',
        '',
        'Keep this'
    ].join('\n'), {
        section: 'Recorded Memory',
        title: 'Timezone',
        content: 'Append this'
    });
    assert.match(appendedSection, /## Existing/);
    assert.match(appendedSection, /## Recorded Memory/);
    assert.match(appendedSection, /Append this/);
});

test('remember: project shared memory updates .harness and regenerates host outputs', () => {
    const root = makeProjectTree('soft-harness-remember-project-', {});
    const result = runRemember(root, {
        scope: 'project',
        llm: 'shared',
        section: 'Working Agreements',
        title: 'Timezone',
        content: 'Always use KST'
    });

    assert.equal(result.scope, 'project');
    assert.equal(result.target, 'shared');
    assert.equal(result.outputRoot, root);
    assert.equal(result.exports.length, 4);
    assert.match(readUtf8(path.join(root, '.harness', 'memory', 'shared.md')), /## Working Agreements/);
    assert.match(readUtf8(path.join(root, '.harness', 'memory', 'shared.md')), /### Timezone/);
    assert.equal(exists(path.join(root, 'CLAUDE.md')), true);
    assert.equal(exists(path.join(root, '.claude', 'CLAUDE.md')), true);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /Always use KST/);
    assert.match(readUtf8(path.join(root, 'GEMINI.md')), /Always use KST/);
    assert.equal(loadState(root).assets.instructions.length, 4);
});

test('remember: llm-specific project memory only regenerates that host outputs', () => {
    const root = makeProjectTree('soft-harness-remember-llm-', {});
    const result = runRemember(root, {
        scope: 'project',
        llm: 'claude',
        section: 'Agent Notes',
        title: 'Review Style',
        content: 'Prioritize findings first.'
    });

    assert.equal(result.exports.length, 2);
    assert.match(readUtf8(path.join(root, '.harness', 'memory', 'llm', 'claude.md')), /Prioritize findings first\./);
    assert.equal(exists(path.join(root, 'AGENTS.md')), false);
    assert.equal(exists(path.join(root, 'GEMINI.md')), false);
    assert.equal(loadState(root).assets.instructions.length, 2);
});

test('remember: account scope uses home .harness and can skip export', () => {
    const projectRoot = makeProjectTree('soft-harness-remember-account-project-', {});
    const homeDir = makeTempDir('soft-harness-remember-account-home-');
    const result = runRemember(projectRoot, {
        scope: 'account',
        llm: 'codex',
        section: 'Preferences',
        title: 'Commit Messages',
        content: 'Keep them imperative.',
        homeDir,
        noExport: true
    });

    assert.equal(result.outputRoot, homeDir);
    assert.match(readUtf8(path.join(homeDir, '.harness', 'memory', 'llm', 'codex.md')), /Keep them imperative\./);
    assert.equal(exists(path.join(homeDir, 'AGENTS.md')), false);
    assert.equal(exists(path.join(homeDir, '.harness', '.sync-state.json')), false);
    assert.equal(exists(path.join(projectRoot, '.harness', 'memory', 'llm', 'codex.md')), false);
});
