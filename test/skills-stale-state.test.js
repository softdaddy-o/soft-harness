// The drift record (.harness/.sync-state.json) is per checkout and
// git-ignored. When source and target are changed together in another
// worktree and merged in, this checkout's record goes stale while the target
// still equals what the source exports. That used to be reported as "the
// target was edited directly" -- false drift. It is now a stale record that a
// real run refreshes; a target that differs from both stays drift.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { buildManagedAssetState, detectSkillsAndAgentsDrift, exportSkillsAndAgents } = require('../src/skills');
const { makeTempDir } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function runCli(root, args) {
    const result = spawnSync('node', [CLI, ...args], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
}

function readState(root) {
    return JSON.parse(readUtf8(path.join(root, '.harness', '.sync-state.json')));
}

function skillRecord(root, target) {
    return readState(root).assets.skills.find((entry) => entry.target === target);
}

// Primary checkout with a recorded export, plus a "worktree" copy of it that
// can change source and target together the way a merged commit would.
function makeProject(prefix, files) {
    const root = makeTempDir(prefix);
    for (const [relativePath, content] of Object.entries(files)) {
        writeUtf8(path.join(root, relativePath), content);
    }
    exportSkillsAndAgents(root, {});
    return root;
}

function stateOf(root) {
    return { assets: buildManagedAssetState(root) };
}

// Simulate "edited and exported elsewhere, then merged": change the source,
// export it in a separate checkout, and bring both source and target back.
function mergeChangeFromWorktree(root, sourceRelative, targetRelative, newSourceFiles) {
    const worktree = makeTempDir('soft-harness-stale-worktree-');
    fs.cpSync(path.join(root, '.harness'), path.join(worktree, '.harness'), { recursive: true });
    for (const [relativePath, content] of Object.entries(newSourceFiles)) {
        writeUtf8(path.join(worktree, relativePath), content);
    }
    exportSkillsAndAgents(worktree, {});
    for (const relativePath of [sourceRelative, targetRelative]) {
        fs.rmSync(path.join(root, relativePath), { recursive: true, force: true });
        fs.cpSync(path.join(worktree, relativePath), path.join(root, relativePath), { recursive: true });
    }
}

test('stale-state: source and target merged together from another worktree is not drift', () => {
    const root = makeProject('soft-harness-stale-merge-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nold body\n'
    });
    const state = stateOf(root);

    mergeChangeFromWorktree(root, '.harness/skills/claude/x', '.claude/skills/x', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nnew body\n'
    });

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift, []);
    assert.deepEqual(staleState.map((entry) => entry.target), ['.claude/skills/x']);
});

test('stale-state: a hand-edited target is still drift', () => {
    const root = makeProject('soft-harness-stale-real-drift-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nbody\n'
    });
    const state = stateOf(root);

    writeUtf8(path.join(root, '.claude', 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\n\nedited by hand\n');

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift.map((entry) => entry.target), ['.claude/skills/x']);
    assert.deepEqual(staleState, []);
});

test('stale-state: a hand-edited target is still drift even when the source also changed', () => {
    const root = makeProject('soft-harness-stale-both-changed-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nbody\n'
    });
    const state = stateOf(root);

    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\n\nsource edit\n');
    writeUtf8(path.join(root, '.claude', 'skills', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\n\ntarget edit\n');

    const drift = detectSkillsAndAgentsDrift(root, { state, staleState: [] });
    assert.deepEqual(drift.map((entry) => entry.target), ['.claude/skills/x']);
});

test('stale-state: a file added by hand to an exported skill is still drift', () => {
    const root = makeProject('soft-harness-stale-added-file-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nbody\n'
    });
    const state = stateOf(root);

    writeUtf8(path.join(root, '.claude', 'skills', 'x', 'notes.md'), 'added by hand\n');

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift.map((entry) => entry.target), ['.claude/skills/x']);
    assert.deepEqual(staleState, []);
});

test('stale-state: blanking exported metadata is still drift though normalization would refill it', () => {
    const root = makeProject('soft-harness-stale-blank-meta-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\n---\n\nbody\n'
    });
    const state = stateOf(root);
    const targetPath = path.join(root, '.claude', 'skills', 'x', 'SKILL.md');
    const exported = readUtf8(targetPath);
    assert.match(exported, /description:/);

    writeUtf8(targetPath, exported.replace(/description:.*\n/u, 'description:\n'));

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift.map((entry) => entry.target), ['.claude/skills/x']);
    assert.deepEqual(staleState, []);
});

test('stale-state: frontmatter quote style alone does not make drift', () => {
    // The source uses plain/single-quoted scalars; export renders them its own
    // way (the target below is written in double quotes). Same meaning.
    const root = makeProject('soft-harness-stale-quotes-', {
        '.harness/skills/claude/x/SKILL.md': '---\nname: x\ndescription: d\n---\n\nbody\n'
    });
    const state = stateOf(root);

    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'x', 'SKILL.md'),
        "---\nname: x\ndescription: 'Run it: daily'\nargument-hint: '[date]'\n---\n\nbody\n");
    writeUtf8(path.join(root, '.claude', 'skills', 'x', 'SKILL.md'),
        '---\nname: "x"\ndescription: "Run it: daily"\nargument-hint: "[date]"\n---\n\nbody\n');

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift, []);
    assert.deepEqual(staleState.map((entry) => entry.target), ['.claude/skills/x']);
});

test('stale-state: an agent changed together with its source is not drift', () => {
    const root = makeProject('soft-harness-stale-agent-', {
        '.harness/agents/claude/helper.md': '# Helper\n'
    });
    const state = stateOf(root);

    writeUtf8(path.join(root, '.harness', 'agents', 'claude', 'helper.md'), '# Helper v2\n');
    writeUtf8(path.join(root, '.claude', 'agents', 'helper.md'), '# Helper v2\n');

    const staleState = [];
    const drift = detectSkillsAndAgentsDrift(root, { state, staleState });
    assert.deepEqual(drift, []);
    assert.deepEqual(staleState.map((entry) => entry.target), ['.claude/agents/helper.md']);
});

test('stale-state: CLI dry-run reports it, a real export refreshes the record, and --import does not pull it back', () => {
    const root = makeTempDir('soft-harness-stale-cli-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'x', 'SKILL.md'), '---\nname: x\ndescription: d\n---\n\nold body\n');
    runCli(root, ['sync', '--export']);
    const before = skillRecord(root, '.claude/skills/x');
    assert.ok(before && before.target_hash);

    mergeChangeFromWorktree(root, '.harness/skills/claude/x', '.claude/skills/x', {
        '.harness/skills/claude/x/SKILL.md': "---\nname: x\ndescription: 'd'\n---\n\nnew body\n"
    });
    const sourceAfterMerge = readUtf8(path.join(root, '.harness', 'skills', 'claude', 'x', 'SKILL.md'));

    const dryRun = runCli(root, ['sync', '--export', '--dry-run']);
    assert.match(dryRun, /drift=0/);
    assert.match(dryRun, /stale-state refreshed/);
    assert.match(dryRun, /\.claude\/skills\/x/);
    assert.equal(skillRecord(root, '.claude/skills/x').target_hash, before.target_hash, 'dry-run must not write the record');

    // Bidirectional sync would pull a drift entry back into the source; a
    // stale record must not be treated that way.
    runCli(root, ['sync', '--export', '--import']);
    assert.equal(readUtf8(path.join(root, '.harness', 'skills', 'claude', 'x', 'SKILL.md')), sourceAfterMerge);
    assert.notEqual(skillRecord(root, '.claude/skills/x').target_hash, before.target_hash);

    const clean = runCli(root, ['sync', '--export', '--dry-run']);
    assert.match(clean, /drift=0/);
    assert.doesNotMatch(clean, /stale-state refreshed/);
});
