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

test('skills: discovery ignores support artifact directories at any depth when hashing skills', () => {
    const root = makeProjectTree('soft-harness-skills-discovery-ignore-depth-', {
        '.claude': {
            skills: {
                shared: {
                    'SKILL.md': '# Shared'
                }
            }
        },
        '.gemini': {
            skills: {
                shared: {
                    'SKILL.md': '# Shared'
                }
            }
        }
    });

    const ignoredPaths = [
        [path.join(root, '.claude', 'skills', 'shared', '.git', 'config'), 'claude git config'],
        [path.join(root, '.gemini', 'skills', 'shared', 'deps', '.git', 'HEAD'), 'gemini git head'],
        [path.join(root, '.claude', 'skills', 'shared', 'lib', 'node_modules', 'pkg', 'index.js'), 'claude node module'],
        [path.join(root, '.gemini', 'skills', 'shared', 'lib', 'node_modules', 'pkg', 'index.js'), 'gemini node module'],
        [path.join(root, '.claude', 'skills', 'shared', 'cache', '__pycache__', 'cache.bin'), 'claude pycache'],
        [path.join(root, '.gemini', 'skills', 'shared', 'cache', '__pycache__', 'cache.bin'), 'gemini pycache'],
        [path.join(root, '.claude', 'skills', 'shared', 'tests', '.pytest_cache', 'cache.json'), 'claude pytest cache'],
        [path.join(root, '.gemini', 'skills', 'shared', 'tests', '.pytest_cache', 'cache.json'), 'gemini pytest cache']
    ];
    for (const [ignoredPath, content] of ignoredPaths) {
        writeUtf8(ignoredPath, content);
    }

    const discoverStable = discoverSkillsAndAgents(root)
        .filter((item) => item.type === 'skill' && item.name === 'shared')
        .sort((left, right) => left.llm.localeCompare(right.llm));
    assert.equal(discoverStable.length, 2);
    const stableHashes = discoverStable.map((item) => item.hash);
    assert.equal(stableHashes[0], stableHashes[1]);

    const imported = importSkillsAndAgents(root, { dryRun: true });
    const commonImports = imported.imported
        .filter((item) => item.type === 'skill' && item.to === '.harness/skills/common/shared');
    assert.equal(commonImports.length, 2);
    assert.ok(commonImports.every((item) => item.bucket === 'common'));

    writeUtf8(path.join(root, '.claude', 'skills', 'shared', 'lib', 'node_modules', 'pkg', 'index.js'), 'claude node module changed');
    const rediscovered = discoverSkillsAndAgents(root)
        .filter((item) => item.type === 'skill' && item.name === 'shared')
        .sort((left, right) => left.llm.localeCompare(right.llm));
    const rediscoveredHashes = rediscovered.map((item) => item.hash);
    assert.equal(rediscoveredHashes[0], stableHashes[0]);
    assert.equal(rediscoveredHashes[0], rediscoveredHashes[1]);

    writeUtf8(path.join(root, '.claude', 'skills', 'shared', 'SKILL.md'), '# Shared edited');
    const afterContentChange = discoverSkillsAndAgents(root)
        .filter((item) => item.type === 'skill' && item.name === 'shared')
        .sort((left, right) => left.llm.localeCompare(right.llm));
    const afterContentHashes = afterContentChange.map((item) => item.hash);
    assert.notEqual(afterContentHashes[0], afterContentHashes[1]);
});

test('skills: identical node_modules-only skill differences hash as common', () => {
    const root = makeProjectTree('soft-harness-skills-discovery-node-modules-only-', {
        '.claude': {
            skills: {
                importer: {
                    'SKILL.md': '# Importer'
                }
            }
        },
        '.gemini': {
            skills: {
                importer: {
                    'SKILL.md': '# Importer'
                }
            }
        }
    });

    writeUtf8(path.join(root, '.claude', 'skills', 'importer', 'assets', 'node_modules', 'import.js'), 'console.log("claude");');
    writeUtf8(path.join(root, '.gemini', 'skills', 'importer', 'assets', 'node_modules', 'import.js'), 'console.log("gemini");');

    const discovered = discoverSkillsAndAgents(root)
        .filter((item) => item.type === 'skill' && item.name === 'importer')
        .sort((left, right) => left.llm.localeCompare(right.llm));
    assert.equal(discovered.length, 2);
    assert.equal(discovered[0].hash, discovered[1].hash);

    const importResult = importSkillsAndAgents(root, {});
    assert.ok(importResult.imported.some((item) => item.type === 'skill' && item.bucket === 'common' && item.to === '.harness/skills/common/importer'));
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

test('skills: export validates source skill trees before writing targets', () => {
    const root = makeProjectTree('soft-harness-skills-export-preflight-', {
        '.harness': {
            skills: {
                common: {
                    unsafe: {
                        'SKILL.md': [
                            '# Unsafe',
                            '',
                            'See `../references/missing.md`.',
                            ''
                        ].join('\n')
                    }
                }
            }
        },
        '.claude': {
            skills: {
                unsafe: {
                    'SKILL.md': '# Existing target'
                }
            }
        }
    });

    assert.throws(() => exportSkillsAndAgents(root, {}), /managed skill export is missing referenced file: \.\.\/references\/missing\.md/);
    assert.match(readUtf8(path.join(root, '.claude', 'skills', 'unsafe', 'SKILL.md')), /# Existing target/);
    assert.equal(exists(path.join(root, '.codex', 'skills', 'unsafe')), false);
});

test('skills: external runtime worktrees are excluded unless explicitly portable', () => {
    const root = makeProjectTree('soft-harness-skills-runtime-exclusion-', {
        '.harness': {
            skills: {
                claude: {
                    runtime: {
                        '.git': { config: '[core]' },
                        bin: { runner: 'runtime' },
                        'SKILL.md': '# Runtime'
                    },
                    portable: {
                        '.git': { config: '[core]' },
                        bin: { runner: 'runtime' },
                        '.harness-portable': '',
                        'SKILL.md': '# Portable'
                    },
                    plain: { 'SKILL.md': '# Plain' }
                }
            }
        }
    });

    const assets = discoverHarnessAssets(root);
    assert.equal(assets.some((item) => item.name === 'runtime'), false);
    assert.equal(assets.some((item) => item.name === 'portable'), true);
    assert.equal(assets.some((item) => item.name === 'plain'), true);
});

test('skills: host runtime worktrees are excluded from discovery', () => {
    const root = makeProjectTree('soft-harness-skills-runtime-discovery-', {
        '.claude': {
            skills: {
                runtime: { '.git': { config: '[core]' }, bin: { runner: 'runtime' }, 'SKILL.md': '# Runtime' },
                portable: { '.git': { config: '[core]' }, bin: { runner: 'runtime' }, '.harness-portable': '', 'SKILL.md': '# Portable' }
            }
        }
    });

    const names = discoverSkillsAndAgents(root).filter((item) => item.type === 'skill').map((item) => item.name);
    assert.equal(names.includes('runtime'), false);
    assert.equal(names.includes('portable'), true);
});

test('skills: export ignores relative directory arguments in inline code examples', () => {
    const root = makeProjectTree('soft-harness-skills-export-cli-directory-', {
        '.harness': {
            skills: {
                common: {
                    finance: {
                        'SKILL.md': 'History directory defaults to `./data/history/`.\n'
                    }
                }
            }
        }
    });

    assert.doesNotThrow(() => exportSkillsAndAgents(root, {}));
    assert.equal(exists(path.join(root, '.claude', 'skills', 'finance', 'SKILL.md')), true);
});

test('skills: export ignores extensionless relative directory arguments in inline code examples', () => {
    const root = makeProjectTree('soft-harness-skills-export-extensionless-directory-', {
        '.harness': {
            skills: {
                common: {
                    experiment: {
                        'SKILL.md': 'Experiment data is stored in `./data/experiments`.\n'
                    }
                }
            }
        }
    });

    assert.doesNotThrow(() => exportSkillsAndAgents(root, {}));
    assert.equal(exists(path.join(root, '.codex', 'skills', 'experiment', 'SKILL.md')), true);
});

test('skills: export validates trailing-slash Markdown links', () => {
    const root = makeProjectTree('soft-harness-skills-export-directory-link-', {
        '.harness': {
            skills: {
                common: {
                    unsafe: {
                        'SKILL.md': '[History directory](./data/history/)\n'
                    }
                }
            }
        }
    });

    assert.throws(() => exportSkillsAndAgents(root, {}), /managed skill export is missing referenced file: \.\/data\/history\//);
});

test('skills: export preflight rejects references missing from exported target layout', () => {
    const root = makeProjectTree('soft-harness-skills-export-target-layout-', {
        '.harness': {
            skills: {
                claude: {
                    unsafe: {
                        'SKILL.md': [
                            '# Unsafe',
                            '',
                            'See `../outside.md`.',
                            ''
                        ].join('\n')
                    },
                    'outside.md': '# Source sibling that is not exported'
                }
            }
        },
        '.claude': {
            skills: {
                unsafe: {
                    'SKILL.md': '# Existing target'
                }
            }
        }
    });

    assert.throws(() => exportSkillsAndAgents(root, {}), /managed skill export is missing referenced file in target layout: \.\.\/outside\.md/);
    assert.match(readUtf8(path.join(root, '.claude', 'skills', 'unsafe', 'SKILL.md')), /# Existing target/);
});

test('skills: export reports host-specific sources shadowed by common bucket', () => {
    const root = makeProjectTree('soft-harness-skills-shadowed-export-', {
        '.harness': {
            skills: {
                common: {
                    foo: {
                        'SKILL.md': '# Common'
                    }
                },
                claude: {
                    foo: {
                        'SKILL.md': '# Claude shadow'
                    }
                }
            },
            agents: {
                common: {
                    'reviewer.toml': [
                        'name = "Reviewer"',
                        'description = "Common reviewer"',
                        'developer_instructions = """',
                        'Review carefully.',
                        '"""',
                        ''
                    ].join('\n')
                },
                codex: {
                    'reviewer.toml': [
                        'name = "Reviewer"',
                        'description = "Codex reviewer"',
                        'developer_instructions = """',
                        'Review carefully.',
                        '"""',
                        ''
                    ].join('\n')
                }
            }
        }
    });

    const result = exportSkillsAndAgents(root, { dryRun: true });

    assert.ok(result.routes.some((entry) => entry.action === 'shadowed'
        && entry.type === 'skill'
        && entry.source === '.harness/skills/claude/foo'
        && entry.shadowedBy === '.harness/skills/common/foo'));
    assert.ok(result.routes.some((entry) => entry.action === 'shadowed'
        && entry.type === 'agent'
        && entry.source === '.harness/agents/codex/reviewer.toml'
        && entry.shadowedBy === '.harness/agents/common/reviewer.toml'));
    assert.equal(result.exported.some((entry) => entry.from === '.harness/skills/claude/foo'), false);
    assert.equal(result.exported.some((entry) => entry.from === '.harness/agents/codex/reviewer.toml'), false);
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

test('skills: exported codex skills quote colon descriptions and backfill missing descriptions', () => {
    const root = makeProjectTree('soft-harness-skill-description-normalize-', {
        '.harness': {
            skills: {
                codex: {
                    analyze: {
                        'SKILL.md': [
                            '---',
                            'name: Analyze',
                            'description: Review state: compare prompts safely.',
                            '---',
                            '',
                            'Inspect the current setup carefully.',
                            ''
                        ].join('\n')
                    },
                    organize: {
                        'SKILL.md': [
                            '# Organize',
                            '',
                            'Apply host changes and refresh harness state carefully for users.',
                            ''
                        ].join('\n')
                    }
                }
            }
        }
    });

    exportSkillsAndAgents(root, {});

    const analyzeSkill = readUtf8(path.join(root, '.codex', 'skills', 'analyze', 'SKILL.md'));
    const organizeSkill = readUtf8(path.join(root, '.codex', 'skills', 'organize', 'SKILL.md'));
    assert.match(analyzeSkill, /^description: "Review state: compare prompts safely\."$/m);
    assert.match(organizeSkill, /^description: ".+"$/m);
});

test('skills: codex agent toml escapes control characters in generated instructions', () => {
    const root = makeProjectTree('soft-harness-agent-toml-safety-', {
        '.claude': {
            agents: {
                'unsafe.md': [
                    '---',
                    'name: Unsafe',
                    'description: Expert reviewer',
                    '---',
                    '',
                    '# Unsafe',
                    '',
                    `First paragraph with control ${String.fromCharCode(1)} character.`,
                    ''
                ].join('\n')
            }
        }
    });

    importSkillsAndAgents(root, {});

    const toml = readUtf8(path.join(root, '.harness', 'agents', 'codex', 'unsafe.toml'));
    assert.match(toml, /description = "Expert reviewer"/);
    assert.match(toml, /\\u0001/);
});

test('skills: plugin codex skill migration preserves original subtree structure', () => {
    const pluginRoot = path.join('.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', '5.0.7');
    const root = makeProjectTree('soft-harness-plugin-skill-structure-', {
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
                            installPath: pluginRoot,
                            gitCommitSha: 'def456'
                        }]
                    }
                }, null, 2),
                cache: {
                    'claude-plugins-official': {
                        superpowers: {
                            '5.0.7': {
                                skills: {
                                    references: {
                                        'helper-surface.md': '# Helper'
                                    },
                                    analyze: {
                                        'SKILL.md': [
                                            '---',
                                            'name: Analyze',
                                            'description: Review state: compare prompts safely.',
                                            '---',
                                            '',
                                            'See `../references/helper-surface.md`.',
                                            ''
                                        ].join('\n'),
                                        'visual-companion.md': '# Visual',
                                        scripts: {
                                            'collect.js': 'console.log("collect");'
                                        }
                                    }
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
    exportSkillsAndAgents(root, {});

    assert.ok(imported.imported.some((entry) => entry.to === '.harness/skills/codex/analyze'));
    assert.equal(exists(path.join(root, '.harness', 'skills', 'codex', 'references', 'helper-surface.md')), true);
    assert.equal(exists(path.join(root, '.harness', 'skills', 'codex', 'analyze', 'visual-companion.md')), true);
    assert.equal(exists(path.join(root, '.codex', 'skills', 'references', 'helper-surface.md')), true);
    assert.equal(exists(path.join(root, '.codex', 'skills', 'analyze', 'scripts', 'collect.js')), true);

    const origin = loadAssetOrigins(root).find((entry) => entry.kind === 'skill' && entry.asset === 'analyze');
    assert.ok(origin);
    assert.equal(origin.plugin, 'superpowers@claude-plugins-official');
    assert.equal(origin.installedVersion, '5.0.7');
    assert.equal(origin.sourcePath, 'skills/analyze');
});
