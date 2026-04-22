const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const {
    detectSkillsAndAgentsDrift,
    discoverHarnessAssets,
    discoverSkillsAndAgents,
    exportSkillsAndAgents,
    importSkillsAndAgents,
    pullBackSkillsAndAgents
} = require('../src/skills');
const { makeProjectTree, makeTempDir } = require('./helpers');

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

test('skills: discovery skips invalid entries and imports agents during dry-run', () => {
    const root = makeProjectTree('soft-harness-skills-discovery-', {
        '.claude': {
            skills: {
                valid: {
                    'SKILL.md': '# Valid'
                },
                invalid: {
                    'README.md': '# Missing skill'
                }
            },
            agents: {
                'helper.md': '# Helper',
                'ignore.txt': 'ignored'
            }
        }
    });

    const discovered = discoverSkillsAndAgents(root);
    assert.deepEqual(discovered.map((item) => `${item.type}:${item.name}`).sort(), ['agent:helper', 'skill:valid']);

    const imported = importSkillsAndAgents(root, { dryRun: true });
    assert.ok(imported.imported.some((item) => item.type === 'agent'));
    assert.equal(exists(path.join(root, '.harness', 'agents', 'claude', 'helper.md')), false);
});

test('skills: discoverHarnessAssets expands common buckets across all llms', () => {
    const root = makeProjectTree('soft-harness-skills-assets-', {
        '.harness': {
            skills: {
                common: {
                    shared: {
                        'SKILL.md': '# Shared'
                    }
                }
            },
            agents: {
                common: {
                    'shared.md': '# Shared agent'
                }
            }
        }
    });

    const assets = discoverHarnessAssets(root);
    assert.equal(assets.filter((item) => item.type === 'skill').length, 3);
    assert.equal(assets.filter((item) => item.type === 'agent').length, 3);
});

test('skills: pull-back skips unsupported entries and dry-run avoids re-export', () => {
    const root = makeProjectTree('soft-harness-skills-pullback-skip-', {
        '.harness': {
            agents: {
                claude: {
                    'worker.md': '# Worker'
                }
            }
        },
        '.claude': {
            agents: {
                'worker.md': '# Worker changed'
            }
        }
    });

    const pulledBack = pullBackSkillsAndAgents(root, [
        { type: 'plugin', target: '.claude/plugins/foo', source: '.harness/plugins/foo' },
        { type: 'agent', target: '.claude/agents/missing.md', source: '.harness/agents/claude/missing.md' },
        { type: 'agent', target: '.claude/agents/worker.md', source: '.harness/agents/claude/worker.md' }
    ], { dryRun: true });

    assert.deepEqual(pulledBack, [{ from: '.claude/agents/worker.md', to: '.harness/agents/claude/worker.md' }]);
    assert.equal(exists(path.join(root, '.harness', 'agents', 'claude', 'worker.md')), true);
});

test('skills: codex exports normalize argument-hint frontmatter and force copy mode', () => {
    const root = makeProjectTree('soft-harness-skills-codex-frontmatter-', {
        '.gitignore': '.codex/skills/\n',
        '.harness': {
            skills: {
                common: {
                    writer: {
                        'SKILL.md': [
                            '---',
                            'name: writer',
                            'description: Help write clearly',
                            'argument-hint: [--dry-run] [--max N] [--days N]',
                            '---',
                            '',
                            '# Writer'
                        ].join('\n')
                    }
                }
            }
        }
    });

    const exported = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    const codexEntry = exported.exported.find((entry) => entry.to === '.codex/skills/writer');

    assert.ok(codexEntry);
    assert.equal(codexEntry.mode, 'copy');
    assert.match(readUtf8(path.join(root, '.codex', 'skills', 'writer', 'SKILL.md')), /argument-hint: "\[--dry-run\] \[--max N\] \[--days N\]"/);
});

test('skills: codex exports block skills without YAML frontmatter', () => {
    const root = makeProjectTree('soft-harness-skills-codex-missing-frontmatter-', {
        '.harness': {
            skills: {
                common: {
                    daily: {
                        'SKILL.md': '# Daily Start'
                    }
                }
            }
        }
    });

    const exported = exportSkillsAndAgents(root, {});
    const blocked = exported.routes.find((entry) => entry.action === 'skip-export' && entry.to === '.codex/skills/daily');

    assert.ok(blocked);
    assert.equal(blocked.reason, 'codex-frontmatter-required');
    assert.equal(exists(path.join(root, '.codex', 'skills', 'daily', 'SKILL.md')), false);
    assert.equal(exists(path.join(root, '.claude', 'skills', 'daily', 'SKILL.md')), true);
});
