const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAssetOrigins } = require('../src/asset-origins');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const {
    buildManagedAssetState,
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
    assert.deepEqual(exported.exported.map((entry) => entry.to), ['.gemini/skills/foo']);
    assert.equal(exists(path.join(root, '.claude', 'skills', 'foo', '.harness-managed')), false);
    assert.equal(exists(path.join(root, '.gemini', 'skills', 'foo', '.harness-managed')), false);
    assert.equal(fs.lstatSync(path.join(root, '.claude', 'skills', 'foo')).isSymbolicLink(), false);
});

test('skills: copy-mode drift is detected for managed skills', () => {
    const root = makeTempDir('soft-harness-skills-drift-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'bar', 'SKILL.md'), '# Bar');
    exportSkillsAndAgents(root, {});
    const state = {
        assets: buildManagedAssetState(root)
    };

    const targetSkill = path.join(root, '.claude', 'skills', 'bar');
    writeUtf8(path.join(targetSkill, 'SKILL.md'), '# Bar changed');
    const drift = detectSkillsAndAgentsDrift(root, { state });
    assert.ok(drift.some((entry) => entry.target === '.claude/skills/bar'));
});

test('skills: pull-back from copy mode updates .harness source without sidecar markers', () => {
    const root = makeTempDir('soft-harness-skills-pullback-');
    writeUtf8(path.join(root, '.harness', 'skills', 'claude', 'keep', 'SKILL.md'), '# Keep');
    exportSkillsAndAgents(root, {});
    const state = {
        assets: buildManagedAssetState(root)
    };

    const targetDir = path.join(root, '.claude', 'skills', 'keep');
    writeUtf8(path.join(targetDir, 'SKILL.md'), '# Keep changed');
    const drift = detectSkillsAndAgentsDrift(root, { state });
    pullBackSkillsAndAgents(root, drift, {});

    assert.equal(exists(path.join(root, '.harness', 'skills', 'claude', 'keep', '.harness-managed')), false);
    assert.equal(exists(path.join(targetDir, '.harness-managed')), false);
    assert.match(readUtf8(path.join(root, '.harness', 'skills', 'claude', 'keep', 'SKILL.md')), /changed/);
});

test('skills: export removes legacy agent sidecar markers outside .harness', () => {
    const root = makeTempDir('soft-harness-skills-agent-legacy-marker-');
    writeUtf8(path.join(root, '.harness', 'agents', 'claude', 'helper.md'), '# Helper');
    writeUtf8(path.join(root, '.claude', 'agents', 'helper.md'), '# Helper');
    writeUtf8(path.join(root, '.claude', 'agents', 'helper.md.harness-managed'), 'legacy');

    exportSkillsAndAgents(root, {});

    assert.equal(exists(path.join(root, '.claude', 'agents', 'helper.md.harness-managed')), false);
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
        },
        '.codex': {
            agents: {
                'reviewer.toml': [
                    'name = "Reviewer"',
                    'description = "Reviews code"',
                    'developer_instructions = """',
                    'Review the code carefully.',
                    '"""',
                    ''
                ].join('\n')
            }
        }
    });

    const discovered = discoverSkillsAndAgents(root);
    assert.deepEqual(discovered.map((item) => `${item.type}:${item.name}`).sort(), ['agent:helper', 'agent:reviewer', 'skill:valid']);

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
    assert.equal(assets.filter((item) => item.type === 'agent').length, 2);
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

test('skills: import ports Claude markdown agents into codex toml agents', () => {
    const root = makeProjectTree('soft-harness-skills-agent-port-', {
        '.claude': {
            agents: {
                'backend-architect.md': [
                    '---',
                    'name: Backend Architect',
                    'description: Senior backend architect specializing in scalable system design.',
                    '---',
                    '',
                    '# Backend Architect',
                    '',
                    'You are a Backend Architect focused on distributed systems, reliability, and service boundaries.',
                    '',
                    'Help design resilient APIs, review architecture decisions, and guide backend implementation tradeoffs.',
                    ''
                ].join('\n')
            }
        }
    });

    const imported = importSkillsAndAgents(root, {});
    assert.ok(imported.imported.some((entry) => entry.to === '.harness/agents/codex/backend-architect.toml'));
    assert.equal(exists(path.join(root, '.harness', 'agents', 'claude', 'backend-architect.md')), true);

    const codexAgent = readUtf8(path.join(root, '.harness', 'agents', 'codex', 'backend-architect.toml'));
    assert.match(codexAgent, /name = "Backend Architect"/);
    assert.match(codexAgent, /description = "Senior backend architect specializing in scalable system design\."/);
    assert.match(codexAgent, /developer_instructions = """[\s\S]*# Backend Architect/);
    assert.match(codexAgent, /You are a Backend Architect focused on distributed systems/);

    const origin = loadAssetOrigins(root).find((entry) => entry.kind === 'agent' && entry.asset === 'backend-architect');
    assert.ok(origin);
    assert.equal(origin.hosts.join(','), 'codex');
    assert.equal(origin.plugin, null);
    assert.equal(origin.sourceType, 'local');
    assert.equal(origin.sourcePath, '.claude/agents/backend-architect.md');
    assert.match(origin.notes, /Codex TOML agent/);
});

test('skills: plugin Claude agents assigned to codex are ported into codex toml agents', () => {
    const root = makeProjectTree('soft-harness-skills-plugin-agent-port-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: superpowers@claude-plugins-official',
                '    llms: [claude, codex]',
                ''
            ].join('\n')
        },
        '.claude': {
            'settings.json': JSON.stringify({
                enabledPlugins: {
                    'superpowers@claude-plugins-official': true
                }
            }, null, 2),
            plugins: {
                'installed_plugins.json': JSON.stringify({
                    version: 2,
                    plugins: {
                        'superpowers@claude-plugins-official': [{
                            version: '5.0.7',
                            installPath: path.join('.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.0.7'),
                            gitCommitSha: 'def456'
                        }]
                    }
                }, null, 2),
                cache: {
                    'claude-plugins-official': {
                        superpowers: {
                            '5.0.7': {
                                agents: {
                                    'code-reviewer.md': [
                                        '---',
                                        'name: Code Reviewer',
                                        'description: Expert reviewer for code quality, bugs, and maintainability.',
                                        '---',
                                        '',
                                        '# Code Reviewer',
                                        '',
                                        'Review code critically, surface regressions, and explain the highest-risk issues first.',
                                        ''
                                    ].join('\n')
                                },
                                'package.json': JSON.stringify({
                                    name: 'superpowers',
                                    version: '5.0.7',
                                    repository: 'https://github.com/obra/superpowers'
                                }, null, 2)
                            }
                        }
                    }
                }
            }
        }
    });

    const imported = importSkillsAndAgents(root, {});
    assert.ok(imported.imported.some((entry) => entry.to === '.harness/agents/codex/code-reviewer.toml'));

    const codexAgent = readUtf8(path.join(root, '.harness', 'agents', 'codex', 'code-reviewer.toml'));
    assert.match(codexAgent, /name = "Code Reviewer"/);
    assert.match(codexAgent, /description = "Expert reviewer for code quality, bugs, and maintainability\."/);
    assert.match(codexAgent, /developer_instructions = """[\s\S]*Review code critically/);

    const origin = loadAssetOrigins(root).find((entry) => entry.kind === 'agent' && entry.asset === 'code-reviewer');
    assert.ok(origin);
    assert.equal(origin.plugin, 'superpowers@claude-plugins-official');
    assert.equal(origin.installedVersion, '5.0.7');
    assert.equal(origin.repo, 'obra/superpowers');
    assert.equal(origin.sourcePath, 'agents/code-reviewer.md');
});
