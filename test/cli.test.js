const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createBackup } = require('../src/backup');
const { main, formatAnalyzeReport, formatRememberReport, formatSyncReport, parseAnalyzeArgs, parseSyncArgs } = require('../src/cli');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { loadFresh, makeProjectTree, makeTempDir } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

test('cli: help lists sync, remember, and revert', () => {
    const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /soft-harness sync/);
    assert.match(result.stdout, /soft-harness remember/);
    assert.match(result.stdout, /soft-harness revert/);
});

test('cli: unknown command exits non-zero', () => {
    const result = spawnSync('node', [CLI, 'bogus'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unknown command/i);
});

test('cli: parseSyncArgs supports explicit link mode flags', () => {
    const parsed = parseSyncArgs(['--dry-run', '--link-mode=symlink', '--force-export-untracked-hosts']);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.linkMode, 'symlink');
    assert.equal(parsed.forceExportUntrackedHosts, true);
});

test('cli: parseAnalyzeArgs supports category, llms, verbose, explain, and json', () => {
    const parsed = parseAnalyzeArgs(['--category=settings', '--llms=claude,codex', '--explain', '--json']);
    assert.equal(parsed.category, 'settings');
    assert.deepEqual(parsed.llms, ['claude', 'codex']);
    assert.equal(parsed.verbose, true);
    assert.equal(parsed.explain, true);
    assert.equal(parsed.json, true);
    assert.throws(() => parseAnalyzeArgs(['--category=bogus']), /invalid --category/i);
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
    assert.match(readUtf8(path.join(root, '.harness', 'HARNESS.md')), /Always use KST/);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), true);
});

test('cli: remember command validates required flags', () => {
    const result = spawnSync('node', [CLI, 'remember', '--title=Timezone'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /remember requires --content/i);
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

test('cli: formatSyncReport shows routing details', () => {
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

    assert.match(output, /📦 import=1  export=1  drift=0  conflicts=0/u);
    assert.match(output, /CLAUDE\.md  \.harness\/llm\/claude\.md/);
    assert.match(output, /├─ Code Style/u);
    assert.match(output, /│  └─ Markdown \(codex와 near match 62%, LLM-specific 유지\)/u);
    assert.match(output, /└─ Git Conventions/u);
    assert.match(output, /AGENTS\.md  \.harness\/llm\/codex\.md/);
    assert.match(output, /section "Code Style" from CLAUDE\.md, AGENTS\.md -> \.harness\/HARNESS\.md/);
    assert.match(output, /\.harness\/HARNESS\.md \+ \.harness\/llm\/claude\.md -> CLAUDE\.md/);
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
                { type: 'skill', relativePath: '.claude/skills/foo' }
            ],
            conflicts: [
                { type: 'instruction', relativePath: 'CLAUDE.md' }
            ]
        },
        pluginActions: [
            { status: 'planned', name: 'superpowers', version: '1.0.0' }
        ]
    }, { explain: true });

    assert.match(output, /✅ imported=0  exported=0  pulled_back=0/u);
    assert.match(output, /backup: 2026-04-13-120000/);
    assert.match(output, /\nexports\n/u);
    assert.match(output, /\.harness\/skills\/common\/foo -> \.claude\/skills\/foo \[copy\] \(default-copy\)/);
    assert.match(output, /skill: \.claude\/skills\/foo/);
    assert.match(output, /instruction: CLAUDE\.md/);
    assert.match(output, /planned: superpowers@1\.0\.0/);
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

    assert.match(output, /left LLM-specific \(near match across claude, codex, similarity=0\.62\)/);
    assert.match(output, /\.claude\/skills\/  \.harness\/skills\/claude\/ \(1 skills, .*llm-specific\)/);
    assert.match(output, /└─ monitor-sentry/u);
    assert.match(output, /solo-agent\.md  \.harness\/agents\/common\/ \(1 agents, identical-across-llms\)/);
    assert.match(output, /└─ solo-agent/u);
});

test('cli: formatAnalyzeReport renders verbose and explain details', () => {
    const output = formatAnalyzeReport({
        summary: { common: 1, similar: 0, conflicts: 0, host_only: 1, unknown: 0 },
        inventory: {
            documents: [{
                llm: 'claude',
                file: 'CLAUDE.md',
                mode: 'import-stub',
                sourceFiles: ['.harness/HARNESS.md', '.harness/llm/claude.md'],
                sectionHeadings: ['Shared'],
                untitledCount: 0
            }],
            settings: [{
                llm: 'claude',
                file: '.claude/settings.json',
                format: 'json',
                status: 'parsed',
                mcpServers: ['shared'],
                hostOnlyKeys: ['theme']
            }]
        },
        common: [{
            category: 'prompts',
            kind: 'section',
            key: 'prompts.section:Shared',
            sources: [{ llm: 'claude', path: 'CLAUDE.md#Shared' }],
            reason: 'normalized section bodies are identical'
        }],
        similar: [],
        conflicts: [],
        host_only: [{
            category: 'skills',
            kind: 'skill',
            key: 'skills.skill.foo',
            sources: [{ llm: 'claude', file: '.claude/skills/foo' }],
            reason: 'skill exists for only one host'
        }],
        unknown: []
    }, { verbose: true, explain: true });

    assert.match(output, /📊 common=1  similar=0  conflicts=0  host_only=1  unknown=0/u);
    assert.match(output, /✅ Common \(동일 내용\)/u);
    assert.match(output, /└─ Shared/u);
    assert.match(output, /📍 Host Only \(한 호스트에만 존재\)/u);
    assert.match(output, /└─ foo/u);
    assert.match(output, /📄 Documents/u);
    assert.match(output, /└─ claude:CLAUDE\.md  \[import-stub\]  headings=1  sources=\.harness\/HARNESS\.md, \.harness\/llm\/claude\.md  sections=Shared/u);
    assert.match(output, /⚙️ Settings/u);
    assert.match(output, /claude:\.claude\/settings\.json  \[json\/parsed\]  mcp=1  keys=1  servers=shared  keys=theme/);
});

test('cli: formatAnalyzeReport shows similar percentages and unknown reasons', () => {
    const output = formatAnalyzeReport({
        summary: { common: 0, similar: 1, conflicts: 0, host_only: 0, unknown: 2 },
        inventory: {
            documents: [],
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
    }, { explain: false });

    assert.match(output, /└─ Repository Overview\s+\(claude  codex, 62%\)/u);
    assert.match(output, /\(codex, 헤딩 없는 내용\)/u);
    assert.match(output, /\(claude, manual review required\)/);
    assert.match(output, /\(gemini, needs manual review\)/);
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
            }]
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
    }, { verbose: true, explain: true });

    assert.match(output, /claude:CLAUDE\.md  \[direct\]  headings=0  sources=CLAUDE\.md  untitled=2/);
    assert.match(output, /codex:\.codex\/config\.toml  \[toml\/parse-error\]  mcp=0  keys=0  error=bad toml/);
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
