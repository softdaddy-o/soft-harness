const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { detectSkillsAndAgentsDrift, exportSkillsAndAgents, importSkillsAndAgents, pullBackSkillsAndAgents } = require('../src/skills');
const { makeTempDir } = require('./helpers');

test('skills: identical project skills import into common bucket and export back out', () => {
    const root = makeTempDir('soft-harness-skills-');
    writeUtf8(path.join(root, '.claude', 'skills', 'foo', 'SKILL.md'), '# Foo');
    writeUtf8(path.join(root, '.codex', 'skills', 'foo', 'SKILL.md'), '# Foo');

    const imported = importSkillsAndAgents(root, {});
    assert.equal(exists(path.join(root, '.harness', 'skills', 'common', 'foo', 'SKILL.md')), true);
    assert.ok(imported.imported.length >= 1);

    const exported = exportSkillsAndAgents(root, {});
    assert.ok(exported.exported.length >= 2);
    assert.equal(exists(path.join(root, '.claude', 'skills', 'foo', '.harness-managed')), true);
    assert.equal(fs.lstatSync(path.join(root, '.claude', 'skills', 'foo')).isSymbolicLink(), false);
});

test('skills: copy-mode drift is detected for managed skills', () => {
    const root = makeTempDir('soft-harness-skills-drift-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'bar', 'SKILL.md'), '# Bar');
    exportSkillsAndAgents(root, {});

    const targetSkill = path.join(root, '.claude', 'skills', 'bar');
    if (exists(path.join(targetSkill, '.harness-managed'))) {
        writeUtf8(path.join(targetSkill, 'SKILL.md'), '# Bar changed');
        const drift = detectSkillsAndAgentsDrift(root);
        assert.ok(drift.some((entry) => entry.target === '.claude/skills/bar'));
    } else {
        assert.equal(exists(path.join(targetSkill, 'SKILL.md')), true);
    }
});

test('skills: explicit link mode still downgrades repo-internal exports to copy when target is not gitignored', () => {
    const root = makeTempDir('soft-harness-skills-safe-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'safe', 'SKILL.md'), '# Safe');

    const exported = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    const entry = exported.exported.find((item) => item.to === '.claude/skills/safe');

    assert.equal(entry.mode, 'copy');
    assert.equal(exists(path.join(root, '.claude', 'skills', 'safe', '.harness-managed')), true);
});

test('skills: pull-back from copy mode does not copy managed marker into .harness source', () => {
    const root = makeTempDir('soft-harness-skills-pullback-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'keep', 'SKILL.md'), '# Keep');
    exportSkillsAndAgents(root, {});

    const targetDir = path.join(root, '.claude', 'skills', 'keep');
    writeUtf8(path.join(targetDir, 'SKILL.md'), '# Keep changed');
    const drift = detectSkillsAndAgentsDrift(root);
    pullBackSkillsAndAgents(root, drift, {});

    assert.equal(exists(path.join(root, '.harness', 'skills', 'claude', 'keep', '.harness-managed')), false);
    assert.match(readUtf8(path.join(root, '.harness', 'skills', 'claude', 'keep', 'SKILL.md')), /changed/);
});
