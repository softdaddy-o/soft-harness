const test = require('node:test');
const assert = require('node:assert/strict');
const { runAnalyze } = require('../src/analyze');
const { buildConcatStub, buildImportStub } = require('../src/stubs');
const { makeProjectTree } = require('./helpers');

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

test('analyze: same-named agents use agent file content for comparison', async () => {
    const root = makeProjectTree('soft-harness-analyze-agents-', {
        '.claude': {
            agents: {
                'reviewer.md': '# Reviewer\nclaude version'
            }
        },
        '.codex': {
            agents: {
                'reviewer.md': '# Reviewer\ncodex version'
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
                plugins: [{ name: 'shared-plugin' }, { name: 'claude-only-plugin' }]
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
    assert.ok(result.common.some((entry) => entry.key === 'plugins.plugin:shared-plugin'));
    assert.ok(result.host_only.some((entry) => entry.key === 'plugins.plugin:claude-only-plugin'));
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
    assert.deepEqual(claudeDocument.sourceFiles, ['.harness/HARNESS.md', '.harness/llm/claude.md']);
    assert.equal(codexDocument.mode, 'concat-stub');
    assert.deepEqual(codexDocument.sourceFiles, ['HARNESS.md', 'llm/codex.md']);
    assert.ok(result.common.some((entry) => entry.key === 'prompts.section:Shared'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Claude Only'));
    assert.ok(result.host_only.some((entry) => entry.key === 'prompts.section:Codex Only'));
    assert.equal(result.unknown.some((entry) => entry.key === 'CLAUDE.md#(untitled)'), false);
    assert.equal(result.unknown.some((entry) => entry.key === 'AGENTS.md#(untitled)'), false);
});
