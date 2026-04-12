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
const { initGitRepo, makeProjectTree, makeTempDir } = require('./helpers');

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

test('skills: gitignored targets allow planned link exports and stable re-export detection', () => {
    const root = makeProjectTree('soft-harness-skills-links-', {
        '.gitignore': '.claude/skills/\n.codex/skills/\n.gemini/skills/\n',
        '.harness': {
            skills: {
                common: {
                    linked: {
                        'SKILL.md': '# Linked'
                    }
                }
            },
            agents: {
                claude: {
                    'helper.md': '# Helper'
                }
            }
        }
    });
    initGitRepo(root);

    const dryRun = exportSkillsAndAgents(root, { dryRun: true, linkMode: 'symlink' });
    assert.ok(dryRun.exported.some((entry) => entry.mode === 'planned-symlink'));

    const exported = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    const linkedTarget = path.join(root, '.claude', 'skills', 'linked');
    if (fs.lstatSync(linkedTarget).isSymbolicLink()) {
        const second = exportSkillsAndAgents(root, { linkMode: 'symlink' });
        assert.equal(second.exported.some((entry) => entry.to === '.claude/skills/linked'), false);
    }
});

test('skills: already matching copy and link targets are treated as up to date', () => {
    const root = makeProjectTree('soft-harness-skills-up-to-date-', {
        '.gitignore': '.claude/skills/\n',
        '.harness': {
            skills: {
                claude: {
                    copytool: {
                        'SKILL.md': '# Copy Tool'
                    },
                    linktool: {
                        'SKILL.md': '# Link Tool'
                    }
                }
            },
            agents: {
                claude: {
                    'helper.md': '# Helper'
                }
            }
        }
    });
    initGitRepo(root);

    exportSkillsAndAgents(root, {});
    const copySecond = exportSkillsAndAgents(root, {});
    assert.equal(copySecond.exported.some((entry) => entry.to === '.claude/agents/helper.md'), false);

    const sourceDir = path.join(root, '.harness', 'skills', 'claude', 'linktool');
    const targetDir = path.join(root, '.claude', 'skills', 'linktool');
    fs.rmSync(targetDir, { recursive: true, force: true });
    try {
        fs.symlinkSync(sourceDir, targetDir, 'junction');
    } catch (error) {
        return;
    }

    const linked = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    assert.equal(linked.exported.some((entry) => entry.to === '.claude/skills/linktool'), false);
});

test('skills: link mode can replace stale regular targets in gitignored directories', () => {
    const root = makeProjectTree('soft-harness-skills-stale-link-', {
        '.gitignore': '.claude/skills/\n',
        '.harness': {
            skills: {
                claude: {
                    stale: {
                        'SKILL.md': '# Fresh'
                    }
                }
            }
        },
        '.claude': {
            skills: {
                stale: {
                    'SKILL.md': '# Stale'
                }
            }
        }
    });
    initGitRepo(root);

    const exported = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    assert.ok(exported.exported.some((entry) => entry.to === '.claude/skills/stale'));
});

test('skills: junction requests and agent drift paths are handled', () => {
    const root = makeProjectTree('soft-harness-skills-junction-', {
        '.gitignore': '.claude/skills/\n',
        '.harness': {
            skills: {
                claude: {
                    junc: {
                        'SKILL.md': '# Junc'
                    }
                }
            },
            agents: {
                claude: {
                    'worker.md': '# Worker'
                }
            }
        }
    });
    initGitRepo(root);

    const exported = exportSkillsAndAgents(root, { linkMode: 'junction' });
    const skillEntry = exported.exported.find((entry) => entry.to === '.claude/skills/junc');
    assert.ok(skillEntry);

    const agentPath = path.join(root, '.claude', 'agents', 'worker.md');
    const markerPath = `${agentPath}.harness-managed`;
    writeUtf8(agentPath, '# Worker changed');
    if (exists(markerPath)) {
        fs.rmSync(markerPath, { force: true });
    }

    const drift = detectSkillsAndAgentsDrift(root);
    assert.ok(drift.some((entry) => entry.type === 'agent' && entry.target === '.claude/agents/worker.md'));
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
