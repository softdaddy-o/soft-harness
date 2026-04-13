const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createBackup } = require('../src/backup');
const { main, formatAnalyzeReport, formatSyncReport, parseAnalyzeArgs, parseSyncArgs } = require('../src/cli');
const { writeUtf8 } = require('../src/fs-util');
const { makeProjectTree, makeTempDir } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

test('cli: help lists sync and revert', () => {
    const result = spawnSync('node', [CLI, 'help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /soft-harness sync/);
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

    assert.match(output, /CLAUDE\.md -> \.harness\/llm\/claude\.md/);
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

    assert.match(output, /sync completed: imported=0 exported=0 pulled_back=0/);
    assert.match(output, /backup: 2026-04-13-120000/);
    assert.match(output, /skill "foo" \.claude\/skills\/foo -> \.harness\/skills\/common\/foo \(identical-across-llms\)/);
    assert.match(output, /section "Guidelines" left LLM-specific/);
    assert.match(output, /\.harness\/skills\/common\/foo -> \.claude\/skills\/foo \[copy\] \(default-copy\)/);
    assert.match(output, /skill: \.claude\/skills\/foo/);
    assert.match(output, /instruction: CLAUDE\.md/);
    assert.match(output, /planned: superpowers@1\.0\.0/);
    assert.match(output, /instruction: CLAUDE\.md/);
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

    assert.match(output, /analyze: common=1 similar=0 conflicts=0 host_only=1 unknown=0/);
    assert.match(output, /documents:/);
    assert.match(output, /claude:CLAUDE\.md \[import-stub\] headings=1 \(sources=\.harness\/HARNESS\.md, \.harness\/llm\/claude\.md; sections=Shared\)/);
    assert.match(output, /settings:/);
    assert.match(output, /claude:\.claude\/settings\.json \[json\/parsed\] mcp=1 keys=1 \(servers=shared; keys=theme\)/);
    assert.match(output, /prompts.section prompts\.section:Shared from claude:CLAUDE\.md#Shared \(normalized section bodies are identical\)/);
    assert.match(output, /skills.skill skills\.skill\.foo from claude:\.claude\/skills\/foo \(skill exists for only one host\)/);
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

    assert.match(output, /claude:CLAUDE\.md \[direct\] headings=0 \(sources=CLAUDE\.md; untitled=2\)/);
    assert.match(output, /codex:\.codex\/config\.toml \[toml\/parse-error\] mcp=0 keys=0 \(error=bad toml\)/);
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
        assert.ok(stdout.join('').includes('dry-run:'));
        stdout.length = 0;

        assert.equal(await main(['node', 'cli.js', 'analyze', '--category=prompts'], {}), 0);
        assert.ok(stdout.join('').includes('analyze:'));
        assert.ok(stdout.join('').includes('documents:'));
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
