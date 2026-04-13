const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { exists, writeUtf8 } = require('../src/fs-util');
const { detectSkillsAndAgentsDrift, exportSkillsAndAgents } = require('../src/skills');
const { initGitRepo, makeProjectTree, makeTempDir } = require('./helpers');

test('skills-links: explicit link mode still downgrades repo-internal exports to copy when target is not gitignored', () => {
    const root = makeTempDir('soft-harness-skills-safe-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'safe', 'SKILL.md'), '# Safe');

    const exported = exportSkillsAndAgents(root, { linkMode: 'symlink' });
    const entry = exported.exported.find((item) => item.to === '.claude/skills/safe');

    assert.equal(entry.mode, 'copy');
    assert.equal(exists(path.join(root, '.claude', 'skills', 'safe', '.harness-managed')), true);
});

test('skills-links: gitignored targets allow planned link exports and stable re-export detection', () => {
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

test('skills-links: already matching copy and link targets are treated as up to date', () => {
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

test('skills-links: link mode can replace stale regular targets in gitignored directories', () => {
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

test('skills-links: junction requests and agent drift paths are handled', () => {
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
