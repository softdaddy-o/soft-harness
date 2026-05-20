const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readUtf8 } = require('../src/fs-util');
const { makeProjectTree } = require('./helpers');

const CLI = path.join(__dirname, '..', 'src', 'cli.js');

function makeMemoryProject(memoryText) {
    return makeProjectTree('soft-harness-memory-partition-', {
        '.harness': {
            'HARNESS.md': '# Shared Guidance\n',
            'llm': {
                'claude.md': '# Claude Notes\n',
                'codex.md': '# Codex Notes\n',
                'gemini.md': '# Gemini Notes\n'
            }
        },
        '.claude': {
            'projects': {
                'D--srcp--demo': {
                    'memory': {
                        'MEMORY.md': memoryText
                    }
                }
            }
        }
    });
}

function addCodexMemory(root, relativePath, memoryText) {
    const target = path.join(root, '.codex', 'memories', relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, memoryText, 'utf8');
    return target;
}

test('memory partition: classifies Claude memory entries by destination', () => {
    const root = makeMemoryProject([
        '- Feedback: in Claude Code, run slash-command reviews before final answers.',
        '- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.',
        '- Active as of 2026-05-19: GitHub issue #42 still tracks the release blocker.',
        '- Stale as of 2025-01-01: old webpack branch is still active.'
    ].join('\n'));
    const { analyzeMemoryPartition } = require('../src/memory-partition');

    const result = analyzeMemoryPartition(root, { now: new Date('2026-05-20T00:00:00Z') });

    assert.deepEqual(result.summary, {
        total: 4,
        claude_only: 1,
        codex_only: 0,
        cross_host: 1,
        project_state: 1,
        stale: 1
    });
    assert.equal(result.entries[0].classification, 'claude-only');
    assert.equal(result.entries[0].action, 'keep');
    assert.equal(result.entries[1].classification, 'cross-host');
    assert.equal(result.entries[1].destination, '.harness/memory/shared.md');
    assert.match(result.entries[1].reason, /environment paths/i);
    assert.equal(result.entries[2].classification, 'project-state');
    assert.equal(result.entries[2].destination, 'docs/memory-project-state.md');
    assert.equal(result.entries[3].classification, 'stale');
    assert.equal(result.entries[3].action, 'remove');
});

test('memory partition: scans Codex memory and records imported-memory provenance', () => {
    const root = makeMemoryProject('- Feedback: in Claude Code, run slash-command reviews before final answers.\n');
    addCodexMemory(root, 'global.md', [
        '- Codex CLI approval policy is host-specific.',
        '- All repositories must use trash-cli for deletes and git worktree branches.'
    ].join('\n'));
    const { runPartitionMemory } = require('../src/memory-partition');

    const applied = runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });

    assert.equal(applied.summary.total, 3);
    assert.equal(applied.summary.codex_only, 1);
    assert.equal(applied.summary.cross_host, 1);

    const shared = readUtf8(path.join(root, '.harness', 'memory', 'shared.md'));
    assert.match(shared, /soft-harness: imported-memory/);
    assert.match(shared, /Imported from codex memory; do not reverse-merge into host memory/);
    assert.match(shared, /trash-cli for deletes and git worktree branches/);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /Imported from codex memory; do not reverse-merge into host memory/);

    const ledger = JSON.parse(readUtf8(path.join(root, '.harness', 'memory', 'partition-state.json')));
    assert.equal(ledger.schema, 1);
    assert.equal(ledger.entries.some((entry) => entry.sourceHost === 'codex' && entry.classification === 'cross-host' && entry.destination === '.harness/memory/shared.md'), true);
    assert.equal(ledger.entries.some((entry) => entry.sourceHost === 'codex' && entry.classification === 'codex-only' && entry.status === 'observed'), true);
});

test('analyze: memory category reports partition recommendations', async () => {
    const root = makeMemoryProject('- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.\n');
    const { runAnalyze } = require('../src/analyze');
    const { formatAnalyzeReport } = require('../src/cli');

    const result = await runAnalyze(root, { category: 'memory', explain: true });
    const output = formatAnalyzeReport(result, { explain: true });

    assert.equal(result.inventory.memory.length, 1);
    assert.equal(result.inventory.memory[0].classification, 'cross-host');
    assert.match(output, /Memory/u);
    assert.match(output, /cross-host -> \.harness\/memory\/shared\.md/);
    assert.match(output, /All credentials are in C:\\Users\\muscly\\.env\.secrets/);
});

test('memory partition: dry-run plans and apply mirrors, moves, removes, and backs up', () => {
    const root = makeMemoryProject([
        '- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.',
        '- Active as of 2026-05-19: GitHub issue #42 still tracks the release blocker.',
        '- Stale as of 2025-01-01: old webpack branch is still active.'
    ].join('\n'));
    const { runPartitionMemory } = require('../src/memory-partition');

    const dryRun = runPartitionMemory(root, {
        dryRun: true,
        now: new Date('2026-05-20T00:00:00Z')
    });

    assert.equal(dryRun.phase, 'dry-run');
    assert.equal(dryRun.summary.cross_host, 1);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);

    const applied = runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });

    assert.equal(applied.phase, 'completed');
    assert.ok(applied.backupTs);
    assert.match(readUtf8(path.join(root, '.harness', 'memory', 'shared.md')), /All credentials are in C:\\Users\\muscly\\.env\.secrets/);
    assert.match(readUtf8(path.join(root, 'docs', 'memory-project-state.md')), /GitHub issue #42/);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /All credentials are in C:\\Users\\muscly\\.env\.secrets/);
    assert.match(readUtf8(path.join(root, 'AGENTS.md')), /Imported from claude memory; do not reverse-merge into host memory/);

    const memory = readUtf8(path.join(root, '.claude', 'projects', 'D--srcp--demo', 'memory', 'MEMORY.md'));
    assert.match(memory, /soft-harness: mirrored to \.harness\/memory\/shared\.md from claude memory; do not reverse-merge/);
    assert.match(memory, /soft-harness: moved to docs\/memory-project-state\.md from claude memory; do not reverse-merge/);
    assert.doesNotMatch(memory, /old webpack branch/);

    const backupManifest = path.join(root, '.harness', 'backups', applied.backupTs, 'manifest.json');
    assert.match(readUtf8(backupManifest), /partition-memory/);
});

test('memory partition: imported stubs are ignored on rerun', () => {
    const root = makeMemoryProject('- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.\n');
    const { runPartitionMemory } = require('../src/memory-partition');

    runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });
    const firstShared = readUtf8(path.join(root, '.harness', 'memory', 'shared.md'));
    const firstMemory = readUtf8(path.join(root, '.claude', 'projects', 'D--srcp--demo', 'memory', 'MEMORY.md'));

    const rerun = runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });

    assert.equal(rerun.summary.cross_host, 0);
    assert.equal(readUtf8(path.join(root, '.harness', 'memory', 'shared.md')), firstShared);
    assert.equal(readUtf8(path.join(root, '.claude', 'projects', 'D--srcp--demo', 'memory', 'MEMORY.md')), firstMemory);
});

test('memory partition: ledger tracks host-only memory changes', () => {
    const root = makeMemoryProject('');
    const codexMemory = addCodexMemory(root, 'global.md', '- Codex CLI should prefer read-only review commands.\n');
    const { runPartitionMemory } = require('../src/memory-partition');

    runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });
    fs.writeFileSync(codexMemory, '- Codex CLI should prefer dry-run review commands.\n', 'utf8');
    runPartitionMemory(root, {
        now: new Date('2026-05-21T00:00:00Z')
    });

    const ledger = JSON.parse(readUtf8(path.join(root, '.harness', 'memory', 'partition-state.json')));
    assert.equal(ledger.entries.filter((entry) => entry.sourceHost === 'codex').length, 2);
    assert.equal(ledger.entries.some((entry) => entry.status === 'missing' && entry.sourceHost === 'codex'), true);
    assert.equal(ledger.entries.some((entry) => entry.status === 'observed' && entry.sourceHost === 'codex' && entry.lastSeenAt === '2026-05-21T00:00:00.000Z'), true);
});

test('memory partition: account-root Claude memory is backed up while project files receive shared output', () => {
    const projectRoot = makeProjectTree('soft-harness-memory-project-root-', {
        '.harness': {
            'HARNESS.md': '# Shared Guidance\n',
            'llm': {
                'claude.md': '# Claude Notes\n',
                'codex.md': '# Codex Notes\n',
                'gemini.md': '# Gemini Notes\n'
            }
        }
    });
    const accountRoot = makeMemoryProject('- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.\n');
    const memoryPath = path.join(accountRoot, '.claude', 'projects', 'D--srcp--demo', 'memory', 'MEMORY.md');
    const { runPartitionMemory } = require('../src/memory-partition');

    const applied = runPartitionMemory(projectRoot, {
        accountRoot,
        now: new Date('2026-05-20T00:00:00Z')
    });

    assert.match(readUtf8(path.join(projectRoot, '.harness', 'memory', 'shared.md')), /All credentials are in C:\\Users\\muscly\\.env\.secrets/);
    assert.match(readUtf8(memoryPath), /soft-harness: mirrored to \.harness\/memory\/shared\.md from claude memory; do not reverse-merge/);

    const manifest = JSON.parse(readUtf8(path.join(projectRoot, '.harness', 'backups', applied.backupTs, 'manifest.json')));
    const externalEntry = manifest.entries.find((entry) => entry.kind === 'external-file');
    assert.equal(externalEntry.originalPath, memoryPath);
    assert.equal(fs.existsSync(path.join(projectRoot, '.harness', 'backups', applied.backupTs, externalEntry.backupPath)), true);
});

test('memory partition: project-state-only runs back up regenerated instruction outputs', () => {
    const root = makeMemoryProject('- Active as of 2026-05-19: GitHub issue #42 still tracks the release blocker.\n');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'manual codex instructions\n', 'utf8');
    const { runPartitionMemory } = require('../src/memory-partition');

    const applied = runPartitionMemory(root, {
        now: new Date('2026-05-20T00:00:00Z')
    });

    const manifest = JSON.parse(readUtf8(path.join(root, '.harness', 'backups', applied.backupTs, 'manifest.json')));
    assert.ok(manifest.entries.some((entry) => entry.path === 'AGENTS.md'));
    assert.match(readUtf8(path.join(root, '.harness', 'backups', applied.backupTs, 'AGENTS.md')), /manual codex instructions/);
});

test('cli: organize --partition-memory dry-run reports memory actions', () => {
    const root = makeMemoryProject('- All credentials are in C:\\Users\\muscly\\.env.secrets. Never hardcode secrets.\n');

    const result = spawnSync('node', [
        CLI,
        'organize',
        '--partition-memory',
        '--dry-run'
    ], {
        cwd: root,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /partition-memory phase=dry-run/);
    assert.match(result.stdout, /cross-host -> \.harness\/memory\/shared\.md/);
    assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});
