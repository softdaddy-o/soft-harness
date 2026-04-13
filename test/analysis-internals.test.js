const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createFinding, formatValuePreview, mergeFindings, normalizeText, similarity } = require('../src/analyze/shared');
const { makeProjectTree, loadFresh } = require('./helpers');

test('analyze/shared: helpers normalize, compare, merge, and preview values', () => {
    assert.equal(normalizeText('  a\r\n\r\n\r\nb  '), 'a\n\nb');
    assert.equal(similarity('', ''), 1);
    assert.ok(similarity('x', 'y') >= 0);
    assert.deepEqual(createFinding('common', { key: 'k' }), { bucket: 'common', key: 'k' });
    assert.deepEqual(mergeFindings(null, { common: [{ key: 'a' }], similar: [], conflicts: [], hostOnly: [], unknown: [] }).common, [{ key: 'a' }]);
    assert.equal(formatValuePreview(null), 'null');
    assert.equal(formatValuePreview('text'), 'text');
    assert.equal(formatValuePreview({ ok: true }), '{"ok":true}');
});

test('analyze/prompts: conflict path and explicit ambiguity callback are covered', async () => {
    const root = makeProjectTree('soft-harness-analyze-conflict-', {
        'CLAUDE.md': '## Conflict\napple orange banana\n',
        'AGENTS.md': '## Conflict\nzxqv mnrp tttt\n'
    });
    const discover = require('../src/discover');
    const originalDiscoverInstructions = discover.discoverInstructions;
    discover.discoverInstructions = async (_rootDir, options) => {
        const llm = await options.classifyAmbiguous('MIXED.md', ['claude', 'codex']);
        return [
            { llm, relativePath: 'CLAUDE.md', absolutePath: path.join(root, 'CLAUDE.md') },
            { llm: 'codex', relativePath: 'AGENTS.md', absolutePath: path.join(root, 'AGENTS.md') }
        ];
    };

    try {
        const { analyzePrompts } = loadFresh('../src/analyze/prompts');
        const result = await analyzePrompts(root, {});
        assert.ok(result.findings.conflicts.some((entry) => entry.key === 'prompts.section:Conflict'));
    } finally {
        discover.discoverInstructions = originalDiscoverInstructions;
        delete require.cache[require.resolve('../src/analyze/prompts')];
    }
});

test('analyze/settings: unsupported manifest types and missing manifests become safe findings', () => {
    const profiles = require('../src/profiles');
    const originalListProfiles = profiles.listProfiles;
    const originalGetProfile = profiles.getProfile;
    profiles.listProfiles = () => ['custom', 'no-manifest'];
    profiles.getProfile = (name) => {
        if (name === 'custom') {
            return { plugins_manifest: '.custom/settings.ini' };
        }
        return { plugins_manifest: '' };
    };

    const root = makeProjectTree('soft-harness-analyze-settings-edge-', {
        '.custom': {
            'settings.ini': 'ignored=true\n'
        }
    });

    try {
        const { analyzeSettings } = loadFresh('../src/analyze/settings');
        const result = analyzeSettings(root, {});
        assert.ok(result.findings.unknown.some((entry) => entry.key === 'settings.custom'));
        assert.equal(result.findings.hostOnly.length, 0);
    } finally {
        profiles.listProfiles = originalListProfiles;
        profiles.getProfile = originalGetProfile;
        delete require.cache[require.resolve('../src/analyze/settings')];
    }
});

test('analyze/settings: toml parser handles invalid lines, empty arrays, booleans, and same-command conflicts', () => {
    const root = makeProjectTree('soft-harness-analyze-settings-toml-', {
        '.claude': {
            'settings.json': JSON.stringify({
                mcpServers: {
                    edge: {
                        command: 'node',
                        args: ['claude', 'alpha', 'beta', 'gamma'],
                        enabled: false
                    }
                }
            }, null, 2)
        },
        '.codex': {
            'config.toml': [
                'nonsense without equals',
                'retries = 42',
                '[mcp_servers.edge]',
                'command = "node"',
                'args = []',
                'enabled = false',
                ''
            ].join('\n')
        }
    });

    const shared = require('../src/analyze/shared');
    const originalSimilarity = shared.similarity;
    shared.similarity = () => 0;
    try {
        const { analyzeSettings } = loadFresh('../src/analyze/settings');
        const result = analyzeSettings(root, {});
        assert.ok(result.findings.conflicts.some((entry) => entry.key === 'settings.mcp.edge'));
    } finally {
        shared.similarity = originalSimilarity;
        delete require.cache[require.resolve('../src/analyze/settings')];
    }
});

test('analyze/settings: parse-error inventory preserves toml format metadata', () => {
    const root = makeProjectTree('soft-harness-analyze-settings-toml-error-', {
        '.codex': {
            'config.toml': '[mcp_servers.edge\ncommand = "node"\n'
        }
    });

    const { analyzeSettings } = require('../src/analyze/settings');
    const result = analyzeSettings(root, { llms: ['codex'] });
    assert.equal(result.settings[0].format, 'toml');
    assert.equal(result.settings[0].status, 'parse-error');
});

test('analyze: runAnalyze selects categories explicitly and by default', async () => {
    const root = makeProjectTree('soft-harness-analyze-run-', {
        'CLAUDE.md': '## Shared\nhello\n',
        '.claude': {
            skills: {
                one: {
                    'SKILL.md': '# One'
                }
            }
        }
    });

    const { runAnalyze } = require('../src/analyze');
    const promptsOnly = await runAnalyze(root, { category: 'prompts' });
    assert.ok(promptsOnly.inventory.documents.length > 0);
    assert.deepEqual(promptsOnly.inventory.settings, []);

    const settingsOnly = await runAnalyze(root, { category: 'settings' });
    assert.deepEqual(settingsOnly.inventory.documents, []);
    assert.ok(Array.isArray(settingsOnly.inventory.settings));

    const skillsOnly = await runAnalyze(root, { category: 'skills' });
    assert.deepEqual(skillsOnly.inventory.documents, []);
    assert.deepEqual(skillsOnly.inventory.settings, []);
    assert.ok(skillsOnly.summary.host_only >= 1);

    const explicitAll = await runAnalyze(root, { category: 'all' });
    assert.ok(explicitAll.summary.host_only >= 1);

    const allCategories = await runAnalyze(root, {});
    assert.ok(allCategories.inventory.documents.length > 0);
    assert.ok(Array.isArray(allCategories.inventory.settings));
    assert.ok(allCategories.summary.host_only >= 1);
});
