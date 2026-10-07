// Issue #23: exporting a skill used to replace the target directory
// wholesale, so any file the .harness/ source does not carry -- runtime state a
// skill writes into its own exported directory -- was deleted without a word.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { exportSkillsAndAgents } = require('../src/skills');
const { parseSyncArgs } = require('../src/cli');
const { makeTempDir } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');
const SKILL = '---\nname: x\ndescription: d\n---\n\n';

function makeSkillProject(prefix, options) {
    const root = makeTempDir(prefix);
    const source = path.join(root, '.harness', 'skills', 'claude', 'x');
    const target = path.join(root, '.claude', 'skills', 'x');
    writeUtf8(path.join(source, 'SKILL.md'), `${SKILL}new body\n`);
    if (options && options.sourceState) {
        writeUtf8(path.join(source, 'state.json'), options.sourceState);
    }
    writeUtf8(path.join(target, 'SKILL.md'), `${SKILL}old body\n`);
    writeUtf8(path.join(target, 'state.json'), '{"seen":[1,2,3]}\n');
    return { root, source, target };
}

function unmanagedPaths(result, action) {
    return result.unmanaged.filter((entry) => entry.action === action).map((entry) => entry.path);
}

test('unmanaged: a target file the source lacks survives export (the worktree case)', () => {
    // In a fresh git worktree the gitignored canonical state.json is absent,
    // so the source carries only SKILL.md while the tracked target has both.
    const { root, target } = makeSkillProject('soft-harness-unmanaged-repro-');

    const result = exportSkillsAndAgents(root, {});

    assert.equal(readUtf8(path.join(target, 'state.json')), '{"seen":[1,2,3]}\n');
    assert.match(readUtf8(path.join(target, 'SKILL.md')), /new body/);
    assert.deepEqual(unmanagedPaths(result, 'preserve'), ['.claude/skills/x/state.json']);
    assert.deepEqual(unmanagedPaths(result, 'prune'), []);
});

test('unmanaged: a file the source carries is still overwritten from the source', () => {
    const { root, target } = makeSkillProject('soft-harness-unmanaged-managed-', {
        sourceState: '{"seen":[1]}\n'
    });
    writeUtf8(path.join(target, 'runtime.log'), 'log\n');

    const result = exportSkillsAndAgents(root, {});

    assert.equal(readUtf8(path.join(target, 'state.json')), '{"seen":[1]}\n');
    assert.equal(readUtf8(path.join(target, 'runtime.log')), 'log\n');
    assert.deepEqual(unmanagedPaths(result, 'preserve'), ['.claude/skills/x/runtime.log']);
});

test('unmanaged: pruneUnmanaged deletes only the files the source lacks', () => {
    const { root, source, target } = makeSkillProject('soft-harness-unmanaged-prune-');

    const result = exportSkillsAndAgents(root, { pruneUnmanaged: true });

    assert.equal(exists(path.join(target, 'state.json')), false);
    assert.match(readUtf8(path.join(target, 'SKILL.md')), /new body/);
    assert.equal(exists(path.join(source, 'SKILL.md')), true);
    assert.deepEqual(unmanagedPaths(result, 'prune'), ['.claude/skills/x/state.json']);
});

test('unmanaged: dry-run lists unmanaged files and changes nothing', () => {
    const { root, target } = makeSkillProject('soft-harness-unmanaged-dry-');

    for (const pruneUnmanaged of [false, true]) {
        const result = exportSkillsAndAgents(root, { dryRun: true, pruneUnmanaged });
        assert.deepEqual(
            unmanagedPaths(result, pruneUnmanaged ? 'prune' : 'preserve'),
            ['.claude/skills/x/state.json']
        );
    }
    assert.equal(readUtf8(path.join(target, 'state.json')), '{"seen":[1,2,3]}\n');
    assert.match(readUtf8(path.join(target, 'SKILL.md')), /old body/);
});

test('unmanaged: an up-to-date target with extra files is not re-exported every run', () => {
    const { root } = makeSkillProject('soft-harness-unmanaged-stable-');
    exportSkillsAndAgents(root, {});

    const second = exportSkillsAndAgents(root, {});

    assert.deepEqual(second.exported, []);
    assert.deepEqual(unmanagedPaths(second, 'preserve'), ['.claude/skills/x/state.json']);
});

test('unmanaged: an unmanaged SKILL.md left in the target is not rewritten', () => {
    const { root, target } = makeSkillProject('soft-harness-unmanaged-nested-');
    const nested = path.join(target, 'local', 'SKILL.md');
    writeUtf8(nested, 'hand-written, no frontmatter\n');

    exportSkillsAndAgents(root, {});

    assert.equal(readUtf8(nested), 'hand-written, no frontmatter\n');
});

test('unmanaged: a type collision is skipped by default and replaced only with pruning', () => {
    const { root, source, target } = makeSkillProject('soft-harness-unmanaged-collision-');
    writeUtf8(path.join(source, 'refs', 'a.md'), 'a\n');
    writeUtf8(path.join(target, 'refs'), 'a file where the source has a directory\n');

    const kept = exportSkillsAndAgents(root, {});
    assert.equal(kept.warnings.length, 1);
    assert.match(kept.warnings[0].reason, /refs.*--prune-unmanaged/);
    assert.equal(fs.lstatSync(path.join(target, 'refs')).isFile(), true);
    assert.match(readUtf8(path.join(target, 'SKILL.md')), /old body/);

    exportSkillsAndAgents(root, { pruneUnmanaged: true });
    assert.equal(readUtf8(path.join(target, 'refs', 'a.md')), 'a\n');
});

test('unmanaged: cli parses --prune-unmanaged and defaults to keeping files', () => {
    assert.equal(parseSyncArgs(['--export']).pruneUnmanaged, false);
    assert.equal(parseSyncArgs(['--export', '--prune-unmanaged']).pruneUnmanaged, true);
});

test('unmanaged: cli dry-run prints the files it would keep or delete', () => {
    const { root, target } = makeSkillProject('soft-harness-unmanaged-cli-');

    const keep = spawnSync('node', [CLI, 'sync', '--export', '--dry-run'], { cwd: root, encoding: 'utf8' });
    assert.equal(keep.status, 0, keep.stderr);
    assert.match(keep.stdout, /unmanaged files \(not in \.harness\/ source; will be kept[^\n]*\n└─ \.claude\/skills\/x\/state\.json/);

    const prune = spawnSync('node', [CLI, 'sync', '--export', '--dry-run', '--prune-unmanaged'], { cwd: root, encoding: 'utf8' });
    assert.equal(prune.status, 0, prune.stderr);
    assert.match(prune.stdout, /will be deleted by --prune-unmanaged\)\n└─ \.claude\/skills\/x\/state\.json/);
    assert.equal(exists(path.join(target, 'state.json')), true);
});

test('unmanaged: a link export keeps a copy instead of replacing a directory with unmanaged files', () => {
    const { root, target } = makeSkillProject('soft-harness-unmanaged-link-');

    const result = exportSkillsAndAgents(root, { linkMode: 'symlink', forceExportUntrackedHosts: true });

    const route = result.routes.find((entry) => entry.action === 'export' && entry.to === '.claude/skills/x');
    assert.equal(route.mode, 'copy');
    assert.equal(route.reason, 'kept-copy-unmanaged-files');
    assert.equal(fs.lstatSync(target).isSymbolicLink(), false);
    assert.equal(readUtf8(path.join(target, 'state.json')), '{"seen":[1,2,3]}\n');
});
