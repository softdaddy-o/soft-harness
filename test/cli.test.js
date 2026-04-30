const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createBackup } = require('../src/backup');
const { __private, main, formatAnalyzeReport, formatRememberReport, formatSyncReport, parseAnalyzeArgs, parseSyncArgs } = require('../src/cli');
const { readUtf8 } = require('../src/fs-util');
const { loadFresh, makeProjectTree, makeTempDir } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

test('cli: help lists sync, analyze, remember, and revert', () => {
    const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /soft-harness sync/);
    assert.match(result.stdout, /soft-harness analyze/);
    assert.match(result.stdout, /soft-harness plugins import-origins/);
    assert.match(result.stdout, /soft-harness origins import/);
    assert.match(result.stdout, /soft-harness prompt --analyze/);
    assert.match(result.stdout, /soft-harness remember/);
    assert.match(result.stdout, /soft-harness revert/);
    assert.doesNotMatch(result.stdout, /curat/i);
});

test('cli: unknown command exits non-zero', () => {
    const result = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/i);
});

test('cli: parseSyncArgs supports explicit link and threshold flags', () => {
    const parsed = parseSyncArgs([
        '--dry-run',
        '--link-mode=symlink',
        '--force-export-untracked-hosts',
        '--codex-plugins-enabled',
        '--heading-threshold=0.7',
        '--body-threshold=0.5'
    ]);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.linkMode, 'symlink');
    assert.equal(parsed.forceExportUntrackedHosts, true);
    assert.equal(parsed.codexPluginsEnabled, true);
    assert.equal(parsed.headingThreshold, 0.7);
    assert.equal(parsed.bodyThreshold, 0.5);
    assert.equal(parsed.root, null);
    assert.equal(parsed.account, false);
});

test('cli: parseAnalyzeArgs supports category, llms, json, and thresholds', () => {
    const parsed = parseAnalyzeArgs([
        '--category=plugins',
        '--llms=claude,codex',
        '--explain',
        '--json',
        '--include-account',
        '--account-root=D:/Users/tester',
        '--heading-threshold=0.7',
        '--body-threshold=0.5'
    ]);
    assert.equal(parsed.category, 'plugins');
    assert.deepEqual(parsed.llms, ['claude', 'codex']);
    assert.equal(parsed.verbose, false);
    assert.equal(parsed.explain, true);
    assert.equal(parsed.json, true);
    assert.equal(parsed.includeAccount, true);
    assert.equal(parsed.accountRoot, path.resolve('D:/Users/tester'));
    assert.equal(parsed.headingThreshold, 0.7);
    assert.equal(parsed.bodyThreshold, 0.5);
    assert.throws(() => parseAnalyzeArgs(['--category=bogus']), /invalid --category/i);
    assert.throws(() => parseAnalyzeArgs(['--heading-threshold=2']), /between 0 and 1/i);
    assert.throws(() => parseAnalyzeArgs(['--account-root=']), /--account-root requires a path/i);
});

test('cli: parse args support root selection and reject ambiguous root flags', () => {
    const syncParsed = parseSyncArgs(['--root=custom/root', '--dry-run']);
    assert.equal(syncParsed.root, 'custom/root');
    assert.equal(syncParsed.account, false);

    const analyzeParsed = parseAnalyzeArgs(['--account', '--category=prompts']);
    assert.equal(analyzeParsed.account, true);
    assert.equal(analyzeParsed.root, null);

    assert.throws(() => parseSyncArgs(['--account', '--root=custom/root']), /cannot combine --root and --account/i);
    assert.throws(() => parseAnalyzeArgs(['--root=', '--category=all']), /--root requires a path/i);
});

test('cli: resolveCommandRoot chooses cwd, explicit root, and account home', () => {
    const cwd = path.resolve('D:/srcp/soft-harness');
    assert.equal(__private.resolveCommandRoot(cwd, {}), cwd);
    assert.equal(__private.resolveCommandRoot(cwd, { root: 'relative-root' }), path.resolve('relative-root'));

    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = 'D:/tmp/home-root';
    process.env.USERPROFILE = '';
    try {
        assert.equal(__private.resolveCommandRoot(cwd, { account: true }), path.resolve('D:/tmp/home-root'));
    } finally {
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
    }
});

test('cli: resolveCommandRoot rejects account mode without a home directory', () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = '';
    process.env.USERPROFILE = '';
    try {
        assert.throws(() => __private.resolveCommandRoot(process.cwd(), { account: true }), /HOME or USERPROFILE/i);
    } finally {
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
    }
});

test('cli: invalid link mode exits non-zero', () => {
    const result = spawnSync('node', [CLI, 'sync', '--link-mode=bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /invalid --link-mode/i);
});

test('cli: remember formats scope, source, and exports', () => {
    const output = formatRememberReport({
        scope: 'account',
        target: 'shared',
        changed: true,
        exports: [{ path: 'CLAUDE.md' }, { path: 'AGENTS.md' }],
        outputRoot: 'C:/Users/tester',
        source: '.harness/HARNESS.md',
        section: 'Working Agreements',
        title: 'Timezone',
        routes: [
            { from: ['.harness/HARNESS.md', '.harness/llm/claude.md'], to: 'CLAUDE.md' },
            { from: ['.harness/HARNESS.md', '.harness/llm/codex.md'], to: 'AGENTS.md' }
        ],
        backupTs: '2026-04-13-140000'
    });

    assert.match(output, /✅ remembered scope=account  target=shared  changed=yes  exports=2/u);
    assert.match(output, /└─ title: Timezone/u);
    assert.match(output, /\nexports\n/u);
    assert.match(output, /\.harness\/HARNESS\.md \+ \.harness\/llm\/claude\.md -> CLAUDE\.md/);
    assert.match(output, /backup: 2026-04-13-140000/);
});

test('cli: remember command writes memory and regenerates outputs', () => {
    const root = makeProjectTree('soft-harness-cli-remember-', {});
    const result = spawnSync('node', [
        CLI,
        'remember',
        '--title=Timezone',
        '--content=Always use KST',
        '--section=Working Agreements'
    ], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /remembered scope=project  target=shared/);
    assert.match(readUtf8(path.join(root, '.harness', 'memory', 'shared.md')), /Always use KST/);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);
});

test('cli: remember command validates required flags', () => {
    const result = spawnSync('node', [CLI, 'remember', '--title=Timezone'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /remember requires --content/i);
});

test('cli: plugins import-origins command imports LLM-found plugin origins', () => {
    const root = makeProjectTree('soft-harness-cli-curate-', {
        '.harness': {},
        'plugin-research.json': JSON.stringify({
            plugin_origins: [{
                plugin: 'frontend-design@claude-code-plugins',
                hosts: ['claude'],
                source_type: 'github',
                repo: 'acme/frontend-design',
                latest_version: '1.4.0'
            }]
        }, null, 2)
    });

    const result = spawnSync('node', [
        CLI,
        'plugins',
        'import-origins',
        '--input=plugin-research.json'
    ], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /plugin origins imported target=plugins  updated=1  file=.harness\/plugin-origins.yaml/);
    assert.match(readUtf8(path.join(root, '.harness', 'plugin-origins.yaml')), /acme\/frontend-design/);
});

test('cli: origins import command imports LLM-found skill and agent origins', () => {
    const root = makeProjectTree('soft-harness-cli-asset-origins-', {
        '.harness': {},
        'asset-origins.json': JSON.stringify({
            asset_origins: [{
                kind: 'skill',
                asset: 'gstack',
                hosts: ['claude'],
                source_type: 'github',
                repo: 'acme/gstack',
                latest_version: '2.0.0'
            }]
        }, null, 2)
    });

    const result = spawnSync('node', [
        CLI,
        'origins',
        'import',
        '--input=asset-origins.json'
    ], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /asset origins imported target=assets  updated=1  file=.harness\/asset-origins.yaml/);
    assert.match(readUtf8(path.join(root, '.harness', 'asset-origins.yaml')), /acme\/gstack/);
});

test('cli: prompt --analyze prints an account-aware LLM workflow prompt', () => {
    const result = spawnSync('node', [CLI, 'prompt', '--analyze', '--account'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /You are helping resolve soft-harness origins/);
    assert.match(result.stdout, /soft-harness analyze --account --category=plugins --json > plugin-research-packet\.json/);
    assert.match(result.stdout, /soft-harness analyze --account --category=skills --json > asset-research-packet\.json/);
    assert.match(result.stdout, /soft-harness plugins import-origins --account --input=plugin-origins\.json/);
    assert.match(result.stdout, /soft-harness origins import --account --input=asset-origins\.json/);
    assert.match(result.stdout, /Find GitHub repositories and official marketplace pages/);
    assert.match(result.stdout, /expert agents/);
    assert.match(result.stdout, /Run the commands yourself/);
    assert.match(result.stdout, /plugin_origins/);
    assert.match(result.stdout, /asset_origins/);
    assert.doesNotMatch(result.stdout, /curat/i);
});

test('cli: prompt command validates required analyze flag', () => {
    const result = spawnSync('node', [CLI, 'prompt'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /prompt requires --analyze/i);
});

test('cli: remember command reports runtime failures', async () => {
    const rememberPath = require.resolve('../src/remember');
    const original = require.cache[rememberPath];
    require.cache[rememberPath] = {
        exports: {
            parseRememberArgs() {
                return {
                    scope: 'project',
                    llm: 'shared',
                    section: 'Recorded Memory',
                    title: 'Timezone',
                    content: 'Always use KST',
                    noExport: false
                };
            },
            runRemember() {
                throw new Error('boom');
            }
        }
    };

    const cli = loadFresh('../src/cli');
    let stdout = '';
    let stderr = '';
    const originalOut = process.stdout.write;
    const originalErr = process.stderr.write;
    process.stdout.write = (chunk) => {
        stdout += chunk;
        return true;
    };
    process.stderr.write = (chunk) => {
        stderr += chunk;
        return true;
    };

    try {
        const code = await cli.main(['node', 'soft-harness', 'remember', '--title=Timezone', '--content=Always use KST']);
        assert.equal(code, 1);
        assert.equal(stdout, '');
        assert.match(stderr, /remember failed: boom/);
    } finally {
        process.stdout.write = originalOut;
        process.stderr.write = originalErr;
        if (original) {
            require.cache[rememberPath] = original;
        } else {
            delete require.cache[rememberPath];
        }
        loadFresh('../src/cli');
    }
});

test('cli: formatSyncReport shows destination-centric routing details with source attribution', () => {
    const output = formatSyncReport({
        phase: 'dry-run',
        plan: {
            import: [1],
            export: [1],
            drift: [],
            conflicts: [],
            plugins: []
        },
        details: {
            imports: [
                { action: 'adopt', from: 'CLAUDE.md', to: '.harness/llm/claude.md' },
                {
                    action: 'adopt-plan',
                    from: 'CLAUDE.md',
                    to: '.harness/llm/claude.md',
                    sections: [
                        { heading: 'Code Style', level: 2, nearMatch: null },
                        { heading: 'Markdown', level: 3, nearMatch: { otherLlms: ['codex'], similarity: 0.62 } },
                        { heading: 'Git Conventions', level: 2, nearMatch: null }
                    ]
                },
                {
                    action: 'adopt-plan',
                    from: 'AGENTS.md',
                    to: '.harness/llm/codex.md',
                    sections: []
                },
                { action: 'extract-common', heading: 'Code Style', from: ['CLAUDE.md', 'AGENTS.md'], to: '.harness/HARNESS.md' }
            ],
            exports: [
                { action: 'export-instruction', from: ['.harness/HARNESS.md', '.harness/llm/claude.md'], to: 'CLAUDE.md' }
            ],
            drift: [],
            conflicts: []
        },
        pluginActions: []
    }, { explain: false });

    assert.match(output, /import=1  export=1  drift=0  conflicts=0/u);
    assert.match(output, /\n\.harness\/llm\/claude\.md\n/u);
    assert.match(output, /from CLAUDE\.md/u);
    assert.match(output, /Code Style/u);
    assert.match(output, /Markdown \(with codex near match 62%, kept LLM-specific\)/u);
    assert.match(output, /Git Conventions/u);
    assert.match(output, /\n\.harness\/llm\/codex\.md\n.+from AGENTS\.md/u);
    assert.doesNotMatch(output, /CLAUDE\.md  \.harness\/llm\/claude\.md/);
    assert.match(output, /section "Code Style" from CLAUDE\.md, AGENTS\.md -> \.harness\/HARNESS\.md/);
    assert.match(output, /\.harness\/HARNESS\.md \+ \.harness\/llm\/claude\.md -> CLAUDE\.md/);
});

test('cli: formatSyncReport omits a lone h1 wrapper when rendering import plan trees', () => {
    const output = formatSyncReport({
        phase: 'dry-run',
        plan: {
            import: [1],
            export: [],
            drift: [],
            conflicts: []
        },
        details: {
            imports: [
                {
                    action: 'adopt-plan',
                    from: '.claude/CLAUDE.md',
                    to: '.harness/llm/claude.md',
                    sections: [
                        { heading: 'Project Title', level: 1, nearMatch: null },
                        { heading: 'Repository Overview', level: 2, nearMatch: null },
                        { heading: 'Build And Run', level: 2, nearMatch: null }
                    ]
                }
            ],
            exports: [],
            drift: [],
            conflicts: []
        },
        pluginActions: []
    }, { explain: true });

    assert.match(output, /\.harness\/llm\/claude\.md/);
    assert.match(output, /from \.claude\/CLAUDE\.md/);
    assert.match(output, /Repository Overview/);
    assert.match(output, /Build And Run/);
    assert.doesNotMatch(output, /Project Title/);
});

test('cli: formatSyncReport keeps legacy adopt imports when no structured adopt plan exists', () => {
    const output = formatSyncReport({
        phase: 'dry-run',
        plan: {
            import: [1],
            export: [],
            drift: [],
            conflicts: []
        },
        details: {
            imports: [
                { action: 'adopt', from: '.claude/CLAUDE.md', to: '.harness/llm/claude.md' }
            ],
            exports: [],
            drift: [],
            conflicts: []
        },
        pluginActions: []
    }, { explain: false });

    assert.match(output, /\nimports\n/u);
    assert.match(output, /\.claude\/CLAUDE\.md -> \.harness\/llm\/claude\.md/u);
});

test('cli: private section tree helper preserves roots unless leading h1 collapse is requested', () => {
    const sections = [
        { heading: 'Project Title', level: 1, nearMatch: null },
        { heading: 'Repository Overview', level: 2, nearMatch: null },
        { heading: 'Build And Run', level: 2, nearMatch: null }
    ];

    const tree = __private.buildSectionTreeItems(sections);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].text, 'Project Title');
    assert.deepEqual(tree[0].children.map((child) => child.text), ['Repository Overview', 'Build And Run']);
});

test('cli: formatSyncReport includes plugins, drift targets, bucket reasons, and completed backups', () => {
    const output = formatSyncReport({
        phase: 'completed',
        imported: [],
        exported: [],
        pulledBack: [],
        backupTs: '2026-04-13-120000',
        details: {
            imports: [
                { action: 'bucket', type: 'skill', name: 'foo', from: '.claude/skills/foo', to: '.harness/skills/common/foo', reason: 'identical-across-llms' },
                { action: 'maybe-common', heading: 'Guidelines', llms: ['claude', 'codex'], similarity: 0.78 }
            ],
            exports: [
                { action: 'export', from: '.harness/skills/common/foo', to: '.claude/skills/foo', mode: 'copy', reason: 'default-copy' }
            ],
            drift: [
                { type: 'skill', relativePath: '.claude/skills/foo' },
                { type: 'plugin', llm: 'codex', name: 'manual-plugin@local' }
            ],
            conflicts: [
                { type: 'instruction', relativePath: 'CLAUDE.md' }
            ]
        },
        pluginActions: [
            { status: 'planned', name: 'superpowers', version: '1.0.0' },
            { type: 'sync-codex-plugin', status: 'planned', name: 'soft-harness@soft-harness', version: '0.4.36', message: 'will install soft-harness@soft-harness-local' },
            { type: 'enable-codex-plugin-feature', status: 'needs-user', name: 'frontend-design', message: 'Enable Codex plugins, then re-run sync.' },
            { type: 'codex-plugin-fallback', path: '.codex/skills/frontend-design' }
        ]
    }, { explain: true });

    assert.match(output, /imported=0  exported=0  pulled_back=0/u);
    assert.match(output, /backup: 2026-04-13-120000/);
    assert.match(output, /\nexports\n/u);
    assert.match(output, /\.harness\/skills\/common\/foo -> \.claude\/skills\/foo \[copy\] \(default-copy\)/);
    assert.match(output, /skill: \.claude\/skills\/foo/);
    assert.match(output, /plugin: manual-plugin@local/);
    assert.match(output, /instruction: CLAUDE\.md/);
    assert.match(output, /planned: superpowers@1\.0\.0/);
    assert.match(output, /planned: soft-harness@soft-harness \(0\.4\.36\) - will install soft-harness@soft-harness-local/);
    assert.doesNotMatch(output, /soft-harness@soft-harness@0\.4\.36/);
    assert.match(output, /needs-user: frontend-design - Enable Codex plugins/);
    assert.match(output, /removed fallback: \.codex\/skills\/frontend-design/);
});

test('cli: formatSyncReport explain covers maybe-common legacy imports and grouped skill buckets', () => {
    const output = formatSyncReport({
        phase: 'dry-run',
        plan: {
            import: [1, 2, 3],
            export: [],
            drift: [],
            conflicts: []
        },
        details: {
            imports: [
                {
                    action: 'maybe-common',
                    heading: 'Repository Overview',
                    llms: ['claude', 'codex'],
                    similarity: 0.62
                },
                {
                    action: 'bucket',
                    type: 'skill',
                    name: 'monitor-sentry',
                    from: '.claude/skills/monitor-sentry',
                    to: '.harness/skills/claude/monitor-sentry',
                    bucket: 'claude',
                    reason: 'llm-specific'
                },
                {
                    action: 'bucket',
                    type: 'agent',
                    name: 'solo-agent',
                    from: 'solo-agent.md',
                    to: '.harness/agents/common/solo-agent',
                    bucket: 'common',
                    reason: 'identical-across-llms'
                }
            ],
            exports: [],
            drift: [],
            conflicts: []
        },
        pluginActions: []
    }, { explain: true });

    assert.match(output, /left LLM-specific \(near match across claude, codex, body 0\.62, heading n\/a\)/);
    assert.match(output, /\.claude\/skills\/  \.harness\/skills\/claude\/ \(1 skills, llm-specific\)/);
    assert.match(output, /└─ monitor-sentry/u);
    assert.match(output, /solo-agent\.md  \.harness\/agents\/common\/ \(1 agents, identical-across-llms\)/);
    assert.match(output, /└─ solo-agent/u);
});

test('cli: formatAnalyzeReport renders document-first explain details as trees', () => {
    const output = formatAnalyzeReport({
        summary: { common: 1, similar: 0, conflicts: 0, host_only: 1, unknown: 0 },
        inventory: {
            documents: [{
                llm: 'claude',
                file: 'CLAUDE.md',
                mode: 'import-stub',
                sourceFiles: ['.harness/HARNESS.md', '.harness/llm/claude.md'],
                sections: [{ heading: 'Shared', level: 1 }],
                headings: 1,
                untitledCount: 0
            }],
            settings: [{
                llm: 'claude',
                file: '.claude/settings.json',
                format: 'json',
                status: 'parsed',
                mcpServers: ['shared'],
                hostOnlyKeys: ['theme']
            }],
            skills: [{
                llm: 'claude',
                skills: ['foo'],
                agents: ['reviewer']
            }],
            plugins: {
                desired: [{
                    name: 'shared-plugin',
                    llms: ['claude', 'codex'],
                    version: '1.0.0'
                }],
                llmPacket: {
                    schema_version: 1,
                    plugins: [{
                        id: 'plugins.plugin:shared-plugin',
                        host: 'claude',
                        display_name: 'shared-plugin',
                        name: 'shared-plugin',
                        registry: null,
                        installed_version: '1.0.0',
                        source_type: 'declared',
                        url: null,
                        author: null,
                        description: null,
                        evidence: 'plugins[]',
                        needs_curation: true
                    }]
                },
                hosts: [{
                    llm: 'claude',
                    plugins: [{
                        name: 'shared-plugin',
                        displayName: 'shared-plugin',
                        sourceType: 'marketplace',
                        version: '1.0.0',
                        registry: null,
                        url: 'https://github.com/softdaddy-o/shared-plugin',
                        evidence: 'plugins[]',
                        latestVersion: '1.2.0',
                        updateAvailable: true,
                        curatedOrigin: {
                            sourceType: 'github',
                            repo: 'softdaddy-o/shared-plugin',
                            url: 'https://github.com/softdaddy-o/shared-plugin',
                            latestVersion: '1.2.0',
                            confidence: 'llm-inferred',
                            notes: 'Matched from plugin title and repository metadata'
                        }
                    }]
                }]
            }
        },
        common: [{
            bucket: 'common',
            category: 'prompts',
            kind: 'section',
            key: 'prompts.section:Shared',
            sources: [
                { llm: 'claude', path: 'CLAUDE.md#Shared' },
                { llm: 'codex', path: 'AGENTS.md#Shared' }
            ],
            reason: 'normalized section bodies are identical'
        }, {
            bucket: 'common',
            category: 'plugins',
            kind: 'plugin',
            key: 'plugins.plugin:shared-plugin',
            sources: [
                { llm: 'claude', file: 'shared-plugin' },
                { llm: 'codex', file: 'shared-plugin' }
            ],
            reason: 'plugin is installed across multiple hosts'
        }],
        similar: [],
        conflicts: [],
        host_only: [{
            bucket: 'host_only',
            category: 'skills',
            kind: 'skill',
            key: 'skills.skill.foo',
            sources: [{ llm: 'claude', file: '.claude/skills/foo' }],
            reason: 'skill exists for only one host'
        }],
        unknown: []
    }, { explain: true });

    assert.match(output, /common=1  similar=0  conflicts=0  host_only=1  unknown=0/u);
    assert.match(output, /Documents/u);
    assert.match(output, /file: claude:CLAUDE\.md \[import-stub\]/u);
    assert.match(output, /sources: \.harness\/HARNESS\.md, \.harness\/llm\/claude\.md/u);
    assert.match(output, /headings: 1/u);
    assert.match(output, /section: Shared \[shared; also present in codex\]/u);
    assert.match(output, /Settings/u);
    assert.match(output, /file: claude:\.claude\/settings\.json \[json\/parsed\]/);
    assert.match(output, /mcp servers: 1/);
    assert.match(output, /host-only keys: 1/);
    assert.match(output, /server: shared/);
    assert.match(output, /key: theme/);
    assert.match(output, /Skills/u);
    assert.match(output, /host: claude/);
    assert.match(output, /skill: foo/);
    assert.match(output, /agent: reviewer/);
    assert.match(output, /Plugins/u);
    assert.match(output, /desired plugins/);
    assert.match(output, /plugin: shared-plugin@1\.0\.0 \[llms: claude, codex\]/);
    assert.match(output, /research packet/);
    assert.match(output, /plugin: shared-plugin \[claude; origin missing\]/);
    assert.match(output, /plugin: shared-plugin \[shared; also present in codex\]/);
    assert.match(output, /source: marketplace/);
    assert.match(output, /version: 1\.0\.0/);
    assert.match(output, /url: https:\/\/github\.com\/softdaddy-o\/shared-plugin/);
    assert.match(output, /evidence: plugins\[\]/);
    assert.match(output, /saved source: github/);
    assert.match(output, /repo: softdaddy-o\/shared-plugin/);
    assert.match(output, /latest version: 1\.2\.0/);
    assert.match(output, /update available: yes \(installed 1\.0\.0 < latest 1\.2\.0\)/);
    assert.doesNotMatch(output, /✅ Common/u);
    assert.doesNotMatch(output, /📁 Host Only/u);
});

test('cli: formatAnalyzeReport keeps zero-count skill hosts in the document-first inventory', () => {
    const output = formatAnalyzeReport({
        score: 100,
        score_reasons: ['No major drift, conflict, or parse issues were detected'],
        summary: { common: 0, similar: 0, conflicts: 0, host_only: 0, unknown: 0 },
        inventory: {
            documents: [],
            settings: [],
            skills: [
                { llm: 'claude', skills: [], agents: [] },
                { llm: 'codex', skills: ['monitor-sentry'], agents: [] },
                { llm: 'gemini', skills: [], agents: [] }
            ],
            plugins: { desired: [], hosts: [] }
        },
        common: [],
        similar: [],
        conflicts: [],
        host_only: [],
        unknown: []
    }, { explain: false });

    assert.match(output, /score: 100\/100 - No major drift, conflict, or parse issues were detected/);
    assert.match(output, /Skills/u);
    assert.match(output, /host: claude/);
    assert.match(output, /host: codex/);
    assert.match(output, /host: gemini/);
    assert.match(output, /skills: 0/);
    assert.match(output, /skills: 1/);
    assert.match(output, /skill: monitor-sentry/);
});

test('cli: formatAnalyzeReport shows similar percentages and unknown reasons', () => {
    const output = formatAnalyzeReport({
        score: 74,
        score_reasons: [
            '2 unknown items still need classification',
            '1 shared item is already aligned across hosts'
        ],
        summary: { common: 0, similar: 1, conflicts: 0, host_only: 0, unknown: 2 },
        inventory: {
            documents: [{
                llm: 'claude',
                file: 'CLAUDE.md',
                mode: 'direct',
                sourceFiles: ['CLAUDE.md'],
                sections: [{ heading: 'Repository Overview', level: 1 }],
                headings: 1,
                untitledCount: 0
            }],
            settings: []
        },
        common: [],
        similar: [{
            bucket: 'similar',
            category: 'prompts',
            kind: 'section',
            key: 'prompts.section:Repository Overview',
            score: 0.62,
            sources: [
                { llm: 'claude', path: 'CLAUDE.md#Repository Overview' },
                { llm: 'codex', path: 'AGENTS.md#Repository Overview' }
            ]
        }],
        conflicts: [],
        host_only: [],
        unknown: [
            {
                bucket: 'unknown',
                category: 'prompts',
                kind: 'section',
                key: 'AGENTS.md#(untitled)',
                sources: [{ llm: 'codex', path: 'AGENTS.md#(untitled)' }],
                reason: 'headingless content cannot be classified reliably'
            },
            {
                bucket: 'unknown',
                category: 'settings',
                kind: 'key',
                key: 'settings.key:custom_flag',
                sources: [{ llm: 'claude', file: '.claude/settings.json' }],
                reason: 'manual review required'
            },
            {
                bucket: 'unknown',
                category: 'prompts',
                kind: 'section',
                key: 'untitled',
                sources: [{ llm: 'gemini', path: 'GEMINI.md#untitled' }],
                reason: 'needs manual review'
            }
        ]
    }, { explain: true });

    assert.match(output, /score: 74\/100 - 2 unknown items still need classification; 1 shared item is already aligned across hosts/);
    assert.match(output, /section: Repository Overview \[similar section also exists in codex, kept separate\]/u);
    assert.doesNotMatch(output, /🔀 Similar/u);
    assert.doesNotMatch(output, /Unknown/u);
});

test('cli: formatAnalyzeReport uses bucket sections when inventory is absent or verbose is requested', () => {
    const outputWithoutInventory = formatAnalyzeReport({
        summary: { common: 0, similar: 1, conflicts: 0, host_only: 0, unknown: 0 },
        inventory: { documents: [], settings: [], skills: [], plugins: { desired: [], hosts: [] } },
        common: [],
        similar: [{
            bucket: 'similar',
            category: 'skills',
            kind: 'skill',
            key: 'skills.skill.foo',
            score: 0.75,
            sources: [
                { llm: 'claude', file: '.claude/skills/foo' },
                { llm: 'codex', file: '.codex/skills/foo' }
            ]
        }],
        conflicts: [],
        host_only: [],
        unknown: []
    }, {});

    assert.match(outputWithoutInventory, /Similar/u);
    assert.match(outputWithoutInventory, /foo\s+\(claude  codex, 75%\)/u);

    const outputVerbose = formatAnalyzeReport({
        summary: { common: 1, similar: 0, conflicts: 0, host_only: 0, unknown: 0 },
        inventory: {
            documents: [{
                llm: 'claude',
                file: 'CLAUDE.md',
                mode: 'direct',
                sourceFiles: ['CLAUDE.md'],
                sections: [{ heading: 'Shared', level: 1 }],
                headings: 1,
                untitledCount: 0
            }],
            settings: [],
            skills: [],
            plugins: { desired: [], hosts: [] }
        },
        common: [{
            bucket: 'common',
            category: 'prompts',
            kind: 'section',
            key: 'prompts.section:Shared',
            sources: [
                { llm: 'claude', path: 'CLAUDE.md#Shared' },
                { llm: 'codex', path: 'AGENTS.md#Shared' }
            ],
            reason: 'normalized section bodies are identical'
        }],
        similar: [],
        conflicts: [],
        host_only: [],
        unknown: []
    }, { verbose: true, explain: true });

    assert.match(outputVerbose, /Documents/u);
    assert.match(outputVerbose, /same content/u);
});

test('cli: formatAnalyzeReport includes untitled prompt counts and settings parse errors', () => {
    const output = formatAnalyzeReport({
        summary: { common: 0, similar: 0, conflicts: 0, host_only: 0, unknown: 1 },
        inventory: {
            documents: [{
                llm: 'claude',
                file: 'CLAUDE.md',
                mode: 'direct',
                sourceFiles: ['CLAUDE.md'],
                sectionHeadings: [],
                untitledCount: 2
            }],
            settings: [{
                llm: 'codex',
                file: '.codex/config.toml',
                format: 'toml',
                status: 'parse-error',
                mcpServers: [],
                hostOnlyKeys: [],
                error: 'bad toml'
            }],
            skills: [],
            plugins: { desired: [], hosts: [] }
        },
        common: [],
        similar: [],
        conflicts: [],
        host_only: [],
        unknown: [{
            category: 'prompts',
            kind: 'section',
            key: 'CLAUDE.md#(untitled)',
            sources: [{ llm: 'claude', path: 'CLAUDE.md#(untitled)' }],
            reason: 'headingless content cannot be classified reliably'
        }]
    }, { explain: true });

    assert.match(output, /file: claude:CLAUDE\.md \[direct\]/);
    assert.match(output, /source: CLAUDE\.md/);
    assert.match(output, /headings: 0/);
    assert.match(output, /untitled blocks: 2/);
    assert.match(output, /file: codex:\.codex\/config\.toml \[toml\/parse-error\]/);
    assert.match(output, /error: bad toml/);
    assert.doesNotMatch(output, /Unknown/u);
});

test('cli: main runs sync, analyze, and revert flows in-process', async () => {
    const root = makeProjectTree('soft-harness-cli-main-', {
        '.harness': {
            'HARNESS.md': 'common'
        },
        'CLAUDE.md': '## Prompt\nclaude',
        '.claude': {
            'settings.json': JSON.stringify({ mcpServers: { shared: { command: 'node' } } }, null, 2)
        }
    });
    createBackup(root, ['CLAUDE.md'], { timestamp: '2026-04-13-120000' });

    const originalCwd = process.cwd();
    const originalStdoutWrite = process.stdout.write;
    const originalStderrWrite = process.stderr.write;
    const stdout = [];
    const stderr = [];
    process.stdout.write = (chunk) => {
        stdout.push(String(chunk));
        return true;
    };
    process.stderr.write = (chunk) => {
        stderr.push(String(chunk));
        return true;
    };

    try {
        process.chdir(root);

        assert.equal(await main(['node', 'cli.js', 'sync', '--dry-run'], {}), 0);
        assert.ok(stdout.join('').includes('📦'));
        stdout.length = 0;

        assert.equal(await main(['node', 'cli.js', 'analyze', '--category=prompts'], {}), 0);
        assert.ok(stdout.join('').includes('📊'));
        stdout.length = 0;

        assert.equal(await main(['node', 'cli.js', 'analyze', '--category=settings', '--json'], {}), 0);
        assert.ok(JSON.parse(stdout.join('')).inventory.settings);
        stdout.length = 0;

        assert.equal(await main(['node', 'cli.js', 'revert', '--list'], {}), 0);
        assert.ok(stdout.join('').includes('2026-04-13-120000'));
        stdout.length = 0;

        assert.equal(await main(['node', 'cli.js', 'revert'], {}), 1);
        assert.ok(stderr.join('').includes('revert requires --list or a timestamp'));
        stderr.length = 0;

        assert.equal(await main(['node', 'cli.js', 'analyze', '--category=bogus'], {}), 1);
        assert.ok(stderr.join('').includes('analyze failed: invalid --category'));
        stderr.length = 0;

        assert.equal(await main(['node', 'cli.js', 'analyze', '--category=settings', '--llms=bogus'], {}), 1);
        assert.ok(stderr.join('').includes('analyze failed: unknown LLM profile'));
        stderr.length = 0;

        assert.equal(await main(['node', 'cli.js', 'revert', 'missing'], {}), 1);
        assert.ok(stderr.join('').includes('revert failed: backup not found'));
    } finally {
        process.chdir(originalCwd);
        process.stdout.write = originalStdoutWrite;
        process.stderr.write = originalStderrWrite;
    }
});

test('cli: main honors --root for sync and --account for analyze', async () => {
    const cwdRoot = makeTempDir('soft-harness-cli-cwd-root-');
    const targetRoot = makeProjectTree('soft-harness-cli-explicit-root-', {
        'CLAUDE.md': '## Prompt\nexplicit root'
    });
    const homeRoot = makeProjectTree('soft-harness-cli-account-root-', {
        '.claude': {
            'settings.json': JSON.stringify({
                mcpServers: {
                    accountOnly: { command: 'node', args: ['account.js'] }
                }
            }, null, 2)
        }
    });

    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalStdoutWrite = process.stdout.write;
    const stdout = [];
    process.stdout.write = (chunk) => {
        stdout.push(String(chunk));
        return true;
    };

    try {
        process.chdir(cwdRoot);

        assert.equal(await main(['node', 'cli.js', 'sync', '--dry-run', `--root=${targetRoot}`], {}), 0);
        assert.match(stdout.join(''), /📦 import=1/u);
        stdout.length = 0;

        process.env.HOME = homeRoot;
        process.env.USERPROFILE = homeRoot;
        assert.equal(await main(['node', 'cli.js', 'analyze', '--account', '--category=settings', '--json'], {}), 0);
        const analyzed = JSON.parse(stdout.join(''));
        assert.deepEqual(analyzed.inventory.settings.map((entry) => entry.file), ['.claude/settings.json']);
        assert.ok(analyzed.host_only.some((entry) => entry.key === 'settings.claude.mcpServers.accountOnly' || entry.key === 'settings.mcp.accountOnly'));
    } finally {
        process.chdir(originalCwd);
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
        process.stdout.write = originalStdoutWrite;
    }
});

test('cli: analyze --include-account compares Codex account MCP definitions with project overrides', async () => {
    const cwdRoot = makeTempDir('soft-harness-cli-cwd-include-account-');
    const homeRoot = makeProjectTree('soft-harness-cli-home-include-account-', {
        '.codex': {
            'config.toml': [
                '[mcp_servers.notionApi]',
                'command = "npx"',
                'args = ["-y", "@notionhq/notion-mcp-server"]',
                ''
            ].join('\n')
        }
    });
    const projectRoot = makeProjectTree('soft-harness-cli-project-include-account-', {
        '.codex': {
            'config.toml': [
                '[mcp_servers.notionApi]',
                'enabled = false',
                ''
            ].join('\n')
        }
    });

    const originalCwd = process.cwd();
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    const originalStdoutWrite = process.stdout.write;
    const stdout = [];
    process.stdout.write = (chunk) => {
        stdout.push(String(chunk));
        return true;
    };

    try {
        process.chdir(cwdRoot);
        process.env.HOME = homeRoot;
        process.env.USERPROFILE = homeRoot;

        assert.equal(await main([
            'node',
            'cli.js',
            'analyze',
            `--root=${projectRoot}`,
            '--include-account',
            '--category=settings',
            '--llms=codex',
            '--json'
        ], {}), 0);

        const analyzed = JSON.parse(stdout.join(''));
        const accountEntry = analyzed.inventory.settings.find((entry) => entry.scope === 'account');
        const projectEntry = analyzed.inventory.settings.find((entry) => entry.scope === 'project');
        assert.deepEqual(accountEntry.mcpServers, ['notionApi']);
        assert.deepEqual(projectEntry.mcpOverrides, ['notionApi']);
    } finally {
        process.chdir(originalCwd);
        process.env.HOME = originalHome;
        process.env.USERPROFILE = originalUserProfile;
        process.stdout.write = originalStdoutWrite;
    }
});

test('cli: revert list prints no backups message when empty', async () => {
    const root = makeTempDir('soft-harness-cli-empty-backups-');
    const originalCwd = process.cwd();
    const originalStdoutWrite = process.stdout.write;
    const stdout = [];
    process.stdout.write = (chunk) => {
        stdout.push(String(chunk));
        return true;
    };

    try {
        process.chdir(root);
        assert.equal(await main(['node', 'cli.js', 'revert', '--list'], {}), 0);
        assert.ok(stdout.join('').includes('No backups available.'));
    } finally {
        process.chdir(originalCwd);
        process.stdout.write = originalStdoutWrite;
    }
});
