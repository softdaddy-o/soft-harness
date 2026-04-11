const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { detectSkillsAndAgentsDrift, exportSkillsAndAgents, importSkillsAndAgents } = require('../src/skills');
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
