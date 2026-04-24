const test = require('node:test');
const assert = require('node:assert/strict');
const { runAnalyze } = require('../src/analyze');
const { buildConcatStub, buildImportStub } = require('../src/stubs');
const { createMemoryFs, makeProjectTree } = require('./helpers');

test('analyze: prompts classify common, similar, host-only, and unknown sections', async () => {
    const root = makeProjectTree('soft-harness-analyze-prompts-', {
        'CLAUDE.md': [
            'Headingless intro',
            '',
            '## Shared',
            'same body',
            '',
            '## Similar',
            'shared idea from claude',
            '',
            '## Claude Only',
            'claude only body',
            ''
        ].join('\n'),
        'AGENTS.md': [
            '## Shared',
            'same body',
            '',
            '## Similar',
            'shared idea from codex',
            '',
            '## Codex Only',
            'codex only body',
            ''
        ].join('\n')
    });

    const result = await runAnalyze(root, { category: 'prompts' });

    assert.deepEqual(result.inventory.documents.map((entry) => entry.file).sort(), ['AGENTS.md', 'CLAUDE.md']);
    assert.ok(result.common.some((entry) => entry.key === 'prompts.section:Shared'));
    assert.ok(result.similar.some((entry) => entry.key === 'prompts.section:Similar'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Claude Only'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Codex Only'));
    assert.ok(result.unknown.some((entry) => entry.key === 'CLAUDE.md#(untitled)'));
});

test('analyze: prompts can match similar headings across hosts when thresholds allow it', async () => {
    const root = makeProjectTree('soft-harness-analyze-prompts-fuzzy-', {
        'CLAUDE.md': '## Repository Overview\nshared workflow from claude\n',
        'AGENTS.md': '## Repo Overview\nshared workflow from codex\n'
    });

    const result = await runAnalyze(root, {
        category: 'prompts',
        headingThreshold: 0.7,
        bodyThreshold: 0.5
    });

    const finding = result.similar.find((entry) => entry.key === 'prompts.section:Repo Overview');
    assert.ok(finding);
    assert.equal(typeof finding.headingScore, 'number');
    assert.equal(typeof finding.bodyScore, 'number');
});

test('analyze: settings classify common, similar, conflict, host-only, and unknown files', async () => {
    const root = makeProjectTree('soft-harness-analyze-settings-', {
        '.claude': {
            'settings.json': JSON.stringify({
                mcpServers: {
                    shared: { command: 'node', args: ['shared.js'] },
                    similar: { command: 'node', args: ['server.js', '--claude'] },
                    conflict: { command: 'python', args: ['server.py'] }
                },
                theme: 'claude-only'
            }, null, 2)
        },
        '.codex': {
            'config.toml': [
                'approval_policy = "never"',
                '[mcp_servers.shared]',
                'command = "node"',
                'args = ["shared.js"]',
                '[mcp_servers.similar]',
                'command = "node"',
                'args = ["server.js", "--codex"]',
                '[mcp_servers.conflict]',
                'command = "bash"',
                'args = ["-lc", "echo nope"]',
                '[mcp_servers.codex_only]',
                'command = "node"',
                'args = ["codex.js"]',
                ''
            ].join('\n')
        },
        '.gemini': {
            'settings.json': '{ not valid json'
        }
    });

    const result = await runAnalyze(root, { category: 'settings' });

    assert.deepEqual(result.inventory.settings.map((entry) => entry.file).sort(), ['.claude/settings.json', '.codex/config.toml', '.gemini/settings.json']);
    assert.ok(result.common.some((entry) => entry.key === 'settings.mcp.shared'));
    assert.ok(result.similar.some((entry) => entry.key === 'settings.mcp.similar'));
    assert.ok(result.conflicts.some((entry) => entry.key === 'settings.mcp.conflict'));
    assert.ok(result.host_only.some((entry) => entry.key === 'settings.mcp.codex_only'));
    assert.ok(result.host_only.some((entry) => entry.key === 'settings.claude.theme'));
    assert.ok(result.host_only.some((entry) => entry.key === 'settings.codex.approval_policy'));
    assert.ok(result.unknown.some((entry) => entry.key === 'settings.gemini'));
    assert.ok(result.score_reasons.some((entry) => /LLM-specific settings conflict/.test(entry)));
    assert.ok(result.score_reasons.some((entry) => /LLM-specific settings item.*out of sync across hosts/.test(entry)));
});

test('analyze: skills classify common, similar, conflict, and host-only content', async () => {
    const root = makeProjectTree('soft-harness-analyze-skills-', {
        '.claude': {
            skills: {
                common: {
                    'SKILL.md': '# Common\nsame'
                },
                similar: {
                    'SKILL.md': '# Similar\nshared intent for claude'
                },
                conflict: {
                    'SKILL.md': '# Conflict\nclaude version'
                }
            },
            agents: {
                'claude-only.md': '# Agent'
            }
        },
        '.codex': {
            skills: {
                common: {
                    'SKILL.md': '# Common\nsame'
                },
                similar: {
                    'SKILL.md': '# Similar\nshared intent for codex'
                },
                conflict: {
                    'SKILL.md': '# Conflict\nwildly different output and semantics'
                }
            }
        }
    });

    const result = await runAnalyze(root, { category: 'skills' });

    assert.deepEqual(result.inventory.skills.map((entry) => entry.llm).sort(), ['claude', 'codex', 'gemini']);
    assert.ok(result.inventory.skills.find((entry) => entry.llm === 'claude').skills.includes('common'));
    assert.ok(result.inventory.skills.find((entry) => entry.llm === 'claude').agents.includes('claude-only'));
    assert.deepEqual(result.inventory.skills.find((entry) => entry.llm === 'gemini'), {
        llm: 'gemini',
        skills: [],
        agents: []
    });
    assert.ok(result.common.some((entry) => entry.key === 'skills.skill.common'));
    assert.ok(result.similar.some((entry) => entry.key === 'skills.skill.similar'));
    assert.ok(result.conflicts.some((entry) => entry.key === 'skills.skill.conflict'));
    assert.ok(result.host_only.some((entry) => entry.key === 'skills.agent.claude-only'));
});

test('analyze: skills expose git origin evidence and agent research packet', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-analyze-skill-origins-root');
        memoryFs.writeTree(root, {
            '.claude': {
                skills: {
                    gstack: {
                        '.git': {
                            config: [
                                '[remote "origin"]',
                                '    url = https://github.com/acme/gstack.git',
                                ''
                            ].join('\n'),
                            HEAD: 'ref: refs/heads/main\n',
                            refs: {
                                heads: {
                                    main: '0123456789abcdef0123456789abcdef01234567\n'
                                }
                            }
                        },
                        'SKILL.md': [
                            '# GStack',
                            '',
                            'Use Gemini Stack for expert repository analysis.'
                        ].join('\n')
                    }
                },
                agents: {
                    'engineering-ai-engineer.md': [
                        '# Engineering AI Engineer',
                        '',
                        'Expert agent for AI engineering work.'
                    ].join('\n')
                }
            },
            '.harness': {
                'asset-origins.yaml': [
                    'asset_origins:',
                    '  - kind: skill',
                    '    asset: gstack',
                    '    hosts: [claude]',
                    '    source_type: unknown',
                    '    notes: Previous LLM pass could not identify the source',
                    '  - kind: agent',
                    '    asset: engineering-ai-engineer',
                    '    hosts: [claude]',
                    '    source_type: github',
                    '    repo: acme/expert-agents',
                    '    url: https://github.com/acme/expert-agents',
                    '    confidence: llm-inferred',
                    '    notes: Matched by agent title and README',
                    ''
                ].join('\n')
            }
        });

        const result = await runAnalyze(root, { category: 'skills' });
        const packet = result.inventory.skillOrigins.llmPacket;
        assert.equal(packet.schema_version, 1);
        assert.equal(Array.isArray(packet.output_schema.asset_origins), true);

        const gstack = packet.assets.find((entry) => entry.kind === 'skill' && entry.name === 'gstack');
        assert.equal(gstack.host, 'claude');
        assert.equal(gstack.source_type, 'github');
        assert.equal(gstack.repo, 'acme/gstack');
        assert.equal(gstack.url, 'https://github.com/acme/gstack');
        assert.equal(gstack.git_commit_sha, '0123456789abcdef0123456789abcdef01234567');
        assert.equal(gstack.needs_origin_research, false);

        const agent = packet.assets.find((entry) => entry.kind === 'agent' && entry.name === 'engineering-ai-engineer');
        assert.equal(agent.source_type, 'github');
        assert.equal(agent.repo, 'acme/expert-agents');
        assert.equal(agent.needs_origin_research, false);
        assert.match(agent.content_preview, /Expert agent/);
        assert.deepEqual(agent.search_hints.slice(0, 3), [
            '"engineering-ai-engineer"',
            '"engineering-ai-engineer.md"',
            '"Engineering AI Engineer"'
        ]);
    });
});

test('analyze: same-named agents use agent file content for comparison', async () => {
    const root = makeProjectTree('soft-harness-analyze-agents-', {
        '.claude': {
            agents: {
                'reviewer.md': '# Reviewer\nclaude version'
            }
        },
        '.codex': {
            agents: {
                'reviewer.yaml': [
                    'interface:',
                    '  display_name: "Reviewer"',
                    '  short_description: "Codex reviewer"',
                    '  default_prompt: "Review code carefully and explain the highest-risk issues first."',
                    ''
                ].join('\n')
            }
        }
    });

    const result = await runAnalyze(root, { category: 'skills' });
    assert.ok(result.similar.some((entry) => entry.key === 'skills.agent.reviewer')
        || result.conflicts.some((entry) => entry.key === 'skills.agent.reviewer'));
});

test('analyze: llm filters narrow prompt and skill analysis', async () => {
    const root = makeProjectTree('soft-harness-analyze-filter-', {
        'CLAUDE.md': '## Shared\nsame\n',
        'AGENTS.md': '## Shared\nsame\n',
        '.claude': {
            skills: {
                one: {
                    'SKILL.md': '# One'
                }
            }
        },
        '.codex': {
            skills: {
                one: {
                    'SKILL.md': '# One'
                }
            }
        }
    });

    const result = await runAnalyze(root, { llms: ['claude'], category: 'all' });

    assert.equal(result.common.some((entry) => entry.key === 'prompts.section:Shared'), false);
    assert.equal(result.common.some((entry) => entry.key === 'skills.skill.one'), false);
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Shared'));
    assert.ok(result.host_only.some((entry) => entry.key === 'skills.skill.one'));
});

test('analyze: plugins classify shared and host-only plugins and expose inventory', async () => {
    const root = makeProjectTree('soft-harness-analyze-plugins-', {
        '.harness': {
            'plugins.yaml': [
                'plugins:',
                '  - name: shared-plugin',
                '    version: 1.2.3',
                '    llms: [claude, codex]',
                '    install: echo install',
                '    uninstall: echo uninstall',
                ''
            ].join('\n')
        },
        '.claude': {
            'settings.json': JSON.stringify({
                plugins: [{ name: 'shared-plugin' }, { name: 'claude-only-plugin', repository: 'github:softdaddy-o/claude-only-plugin' }]
            }, null, 2)
        },
        '.codex': {
            'config.toml': [
                '[plugins.shared-plugin]',
                'name = "shared-plugin"',
                ''
            ].join('\n')
        }
    });

    const result = await runAnalyze(root, { category: 'plugins' });

    assert.deepEqual(result.inventory.plugins.desired.map((entry) => entry.name), ['shared-plugin']);
    assert.deepEqual(result.inventory.plugins.hosts.map((entry) => entry.llm).sort(), ['claude', 'codex', 'gemini']);
    const claudePlugins = result.inventory.plugins.hosts.find((entry) => entry.llm === 'claude').plugins;
    assert.equal(claudePlugins[0].displayName, 'claude-only-plugin');
    assert.equal(claudePlugins[0].sourceType, 'github');
    assert.equal(claudePlugins[0].url, 'https://github.com/softdaddy-o/claude-only-plugin');
    assert.equal(claudePlugins[1].displayName, 'shared-plugin');
    assert.equal(claudePlugins[1].sourceType, 'declared');
    assert.ok(result.common.some((entry) => entry.key === 'plugins.plugin:shared-plugin'));
    assert.ok(result.host_only.some((entry) => entry.key === 'plugins.plugin:claude-only-plugin'));
});

test('analyze: plugins expose an llm research packet and merge curated origin metadata', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-analyze-plugins-packet-root');
        memoryFs.writeTree(root, {
            '.harness': {
                'plugin-origins.yaml': [
                    'plugin_origins:',
                    '  - plugin: frontend-design@claude-code-plugins',
                    '    hosts: [claude]',
                    '    source_type: github',
                    '    repo: acme/frontend-design',
                    '    url: https://github.com/acme/frontend-design',
                    '    latest_version: 1.4.0',
                    '    confidence: llm-inferred',
                    '    notes: Matched from plugin title and repository metadata',
                    ''
                ].join('\n')
            },
            '.claude': {
                'settings.json': JSON.stringify({
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true
                    }
                }, null, 2),
                plugins: {
                    cache: {
                        'claude-code-plugins': {
                            'frontend-design': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'frontend-design',
                                            version: '1.0.0'
                                        }, null, 2)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = await runAnalyze(root, { category: 'plugins' });

        assert.equal(result.inventory.plugins.llmPacket.schema_version, 1);
        assert.equal(result.inventory.plugins.llmPacket.instructions.length, 3);
        assert.equal(Array.isArray(result.inventory.plugins.llmPacket.output_schema.plugin_origins), true);
        assert.equal(result.inventory.plugins.llmPacket.plugins.length, 1);
        assert.deepEqual(result.inventory.plugins.llmPacket.plugins[0], {
            id: 'plugins.plugin:frontend-design@claude-code-plugins',
            host: 'claude',
            display_name: 'frontend-design@claude-code-plugins',
            name: 'frontend-design',
            registry: 'claude-code-plugins',
            installed_version: '1.0.0',
            source_type: 'marketplace',
            repo: null,
            url: null,
            source_path: null,
            git_commit_sha: null,
            author: null,
            description: null,
            evidence: 'enabledPlugins + cache metadata',
            needs_curation: false
        });

        const entry = result.inventory.plugins.hosts.find((host) => host.llm === 'claude').plugins[0];
        assert.equal(entry.curatedOrigin.sourceType, 'github');
        assert.equal(entry.curatedOrigin.repo, 'acme/frontend-design');
        assert.equal(entry.latestVersion, '1.4.0');
        assert.equal(entry.updateAvailable, true);
    });
});

test('analyze: plugin research packet includes local github origin evidence', async () => {
    const memoryFs = createMemoryFs();
    await memoryFs.run(async () => {
        const root = memoryFs.root('soft-harness-analyze-plugin-origin-evidence-root');
        memoryFs.writeTree(root, {
            '.claude': {
                'settings.json': JSON.stringify({
                    enabledPlugins: {
                        'frontend-design@claude-code-plugins': true
                    }
                }, null, 2),
                plugins: {
                    'known_marketplaces.json': JSON.stringify({
                        'claude-code-plugins': {
                            source: {
                                source: 'github',
                                repo: 'anthropics/claude-code'
                            }
                        }
                    }, null, 2),
                    'installed_plugins.json': JSON.stringify({
                        version: 2,
                        plugins: {
                            'frontend-design@claude-code-plugins': [{
                                version: '1.0.0',
                                gitCommitSha: 'abc123'
                            }]
                        }
                    }, null, 2),
                    marketplaces: {
                        'claude-code-plugins': {
                            '.claude-plugin': {
                                'marketplace.json': JSON.stringify({
                                    plugins: [{
                                        name: 'frontend-design',
                                        version: '1.0.0',
                                        source: './plugins/frontend-design'
                                    }]
                                }, null, 2)
                            }
                        }
                    },
                    cache: {
                        'claude-code-plugins': {
                            'frontend-design': {
                                '1.0.0': {
                                    '.claude-plugin': {
                                        'plugin.json': JSON.stringify({
                                            name: 'frontend-design',
                                            version: '1.0.0'
                                        }, null, 2)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        const result = await runAnalyze(root, { category: 'plugins' });
        const packetEntry = result.inventory.plugins.llmPacket.plugins[0];
        assert.equal(packetEntry.repo, 'anthropics/claude-code');
        assert.equal(packetEntry.url, 'https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design');
        assert.equal(packetEntry.source_path, 'plugins/frontend-design');
        assert.equal(packetEntry.git_commit_sha, 'abc123');
        assert.match(packetEntry.evidence, /known_marketplaces/);
    });
});

test('analyze: managed prompt stubs resolve to backing harness content instead of stub noise', async () => {
    const common = '## Shared\nsame body\n';
    const root = makeProjectTree('soft-harness-analyze-managed-prompts-', {
        '.harness': {
            'HARNESS.md': common,
            llm: {
                'claude.md': '## Claude Only\nclaude body\n',
                'codex.md': '## Codex Only\ncodex body\n'
            }
        },
        'CLAUDE.md': buildImportStub('claude'),
        'AGENTS.md': buildConcatStub('codex', common, '## Codex Only\ncodex body\n')
    });

    const result = await runAnalyze(root, { category: 'prompts' });

    const claudeDocument = result.inventory.documents.find((entry) => entry.file === 'CLAUDE.md');
    const codexDocument = result.inventory.documents.find((entry) => entry.file === 'AGENTS.md');
    assert.equal(claudeDocument.mode, 'import-stub');
    assert.deepEqual(claudeDocument.sourceFiles, [
        '.harness/HARNESS.md',
        '.harness/memory/shared.md',
        '.harness/llm/claude.md',
        '.harness/memory/llm/claude.md'
    ]);
    assert.equal(codexDocument.mode, 'concat-stub');
    assert.deepEqual(codexDocument.sourceFiles, [
        'HARNESS.md',
        'memory/shared.md',
        'llm/codex.md',
        'memory/llm/codex.md'
    ]);
    assert.ok(result.common.some((entry) => entry.key === 'prompts.section:Shared'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Claude Only'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Codex Only'));
    assert.equal(result.unknown.some((entry) => entry.key === 'CLAUDE.md#(untitled)'), false);
    assert.equal(result.unknown.some((entry) => entry.key === 'AGENTS.md#(untitled)'), false);
});
