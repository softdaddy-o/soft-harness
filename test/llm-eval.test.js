const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
    checkScenarioRun,
    loadScenarioCatalog,
    prepareScenarioRun,
    transcriptContains
} = require('../src/llm-eval');
const { makeProjectTree } = require('./helpers');
const { readJson, readUtf8, writeUtf8 } = require('../src/fs-util');

function makeVirtualPcFixture() {
    return makeProjectTree('soft-harness-llm-eval-', {
        'pc-image': {
            'C': {
                'Users': {
                    'primary-user': {
                        'CLAUDE.md': '# Claude Root\n',
                        '.claude': {
                            'settings.json': JSON.stringify({
                                approval_policy: 'never',
                                mcpServers: {
                                    shared: {
                                        command: 'node'
                                    }
                                }
                            }, null, 2)
                        },
                        '.codex': {
                            'config.toml': 'approval_policy = "never"\n'
                        }
                    }
                }
            },
            'F': {
                'src3': {
                    'docs': {
                        'workspace-001': {
                            'AGENTS.md': '# Workspace Agents\n',
                            '.claude': {
                                'settings.local.json': JSON.stringify({
                                    mcpServers: {
                                        workspaceOnly: {
                                            command: 'node'
                                        }
                                    }
                                }, null, 2)
                            }
                        }
                    }
                }
            }
        }
    });
}

test('llm eval: loads shipped scenarios', () => {
    const scenarios = loadScenarioCatalog(path.join(__dirname, '..'));
    assert.ok(scenarios.length >= 5);
    assert.ok(scenarios.some((scenario) => scenario.id === 'analyze-clean-start-dry-run'));
    assert.ok(scenarios.some((scenario) => scenario.id === 'organize-remember-rule'));
});

test('llm eval: prepare creates sandbox, metadata, and prompt package', () => {
    const virtualPcRoot = makeVirtualPcFixture();
    const outputDir = path.join(virtualPcRoot, 'prepared-run');
    const result = prepareScenarioRun({
        repoRoot: path.join(__dirname, '..'),
        virtualPcRoot,
        outputDir,
        scenario: {
            id: 'prepare-smoke',
            skill: 'analyze',
            root: {
                kind: 'account'
            },
            user_request: 'Use the analyze skill in --dry-run mode.',
            flags: {
                dry_run: true,
                web_allowed: false
            },
            seed_files: {
                '.claude/settings.json': '{\n  "broken": true\n}\n'
            },
            expectations: {
                filesystem: {
                    must_not_write: true
                }
            }
        }
    });

    assert.equal(result.runDir, outputDir);
    assert.equal(readJson(path.join(outputDir, 'before-manifest.json')).files.length >= 3, true);
    assert.match(readUtf8(path.join(outputDir, 'USER_PROMPT.md')), /Sandbox root:/);
    assert.match(readUtf8(path.join(outputDir, 'RUNBOOK.md')), /check/);
    assert.equal(readUtf8(path.join(outputDir, 'sandbox-root', '.claude', 'settings.json')).includes('"broken": true'), true);
});

test('llm eval: prepare can stage the codex plugin before the baseline manifest', () => {
    const virtualPcRoot = makeVirtualPcFixture();
    const outputDir = path.join(virtualPcRoot, 'prepared-codex-run');
    const result = prepareScenarioRun({
        repoRoot: path.join(__dirname, '..'),
        virtualPcRoot,
        outputDir,
        stageCodexPlugin: true,
        scenario: {
            id: 'prepare-codex-smoke',
            skill: 'analyze',
            root: {
                kind: 'account'
            },
            user_request: 'Use the analyze skill in --dry-run mode.',
            flags: {
                dry_run: true,
                web_allowed: false
            },
            expectations: {
                filesystem: {
                    must_not_write: true
                }
            }
        }
    });

    const metadata = readJson(path.join(outputDir, 'eval-run.json'));
    assert.deepEqual(metadata.staged_assets, ['.agents/plugins/marketplace.json', 'plugins/soft-harness']);
    assert.equal(result.beforeManifest.files.some((entry) => entry.path === '.agents/plugins/marketplace.json'), true);
    assert.equal(result.beforeManifest.files.some((entry) => entry.path === 'plugins/soft-harness/skills/analyze/SKILL.md'), true);
    assert.match(readUtf8(path.join(outputDir, 'USER_PROMPT.md')), /staged plugin scaffolding/i);
});

test('llm eval: dry-run check passes with unchanged files and compliant transcript', () => {
    const virtualPcRoot = makeVirtualPcFixture();
    const outputDir = path.join(virtualPcRoot, 'dry-run-check');
    prepareScenarioRun({
        repoRoot: path.join(__dirname, '..'),
        virtualPcRoot,
        outputDir,
        scenario: {
            id: 'dry-run-check',
            skill: 'analyze',
            root: {
                kind: 'account'
            },
            user_request: 'Use analyze in --dry-run mode.',
            flags: {
                dry_run: true,
                web_allowed: false
            },
            expectations: {
                filesystem: {
                    must_not_write: true,
                    forbidden_paths: ['.harness']
                },
                transcript: {
                    must_mention: ['dry-run', '.harness'],
                    must_not_mention: ['setup'],
                    max_question_lines: 1
                }
            }
        }
    });

    writeUtf8(path.join(outputDir, 'transcript.md'), [
        'I used analyze in dry-run mode.',
        'A missing .harness snapshot is normal here.'
    ].join('\n'));

    const result = checkScenarioRun({
        runDir: outputDir
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.diff.added.length, 0);
    assert.equal(result.diff.changed.length, 0);
    assert.equal(result.diff.removed.length, 0);
});

test('llm eval: organize check catches writes and required outputs', () => {
    const virtualPcRoot = makeVirtualPcFixture();
    const outputDir = path.join(virtualPcRoot, 'organize-check');
    prepareScenarioRun({
        repoRoot: path.join(__dirname, '..'),
        virtualPcRoot,
        outputDir,
        scenario: {
            id: 'organize-check',
            skill: 'organize',
            root: {
                kind: 'account'
            },
            user_request: 'Use organize to remember a rule.',
            flags: {
                dry_run: false,
                web_allowed: false
            },
            expectations: {
                filesystem: {
                    must_write: true,
                    required_paths: [
                        '.harness/HARNESS.md',
                        '.harness/memory/shared.md'
                    ],
                    backup_required: true
                },
                transcript: {
                    must_mention: ['memory', 'backup'],
                    must_not_mention: ['sync'],
                    max_question_lines: 1
                }
            }
        }
    });

    writeUtf8(path.join(outputDir, 'sandbox-root', '.harness', 'HARNESS.md'), '# Snapshot\n');
    writeUtf8(path.join(outputDir, 'sandbox-root', '.harness', 'memory', 'shared.md'), '- Explain risky MCP changes with rollback notes.\n');
    writeUtf8(path.join(outputDir, 'sandbox-root', '.harness', 'backups', '20260417-000000', 'manifest.json'), '{\n  "entries": []\n}\n');
    writeUtf8(path.join(outputDir, 'transcript.md'), 'I updated memory and recorded a backup before changing host-facing guidance.\n');

    const result = checkScenarioRun({
        runDir: outputDir
    });

    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.ok(result.diff.added.includes('.harness/HARNESS.md'));
});

test('llm eval: transcript matcher avoids false positives on compound sync names', () => {
    assert.equal(transcriptContains('Would create .harness/.sync-state.json', 'sync'), false);
    assert.equal(transcriptContains('Legacy setup flow is deprecated.', 'setup'), true);
    assert.equal(transcriptContains('Missing .harness is normal.', '.harness'), true);
    assert.equal(transcriptContains('Keep host-local overlays for path-dependent fields.', 'host-local'), true);
    assert.equal(transcriptContains('Host files would be updated only after approval.', 'host changes'), true);
    assert.equal(transcriptContains('\uacf5\uc720 \uac00\ub2a5\ud55c \uac83 vs \ub85c\uceec \uc9c4\ub2e8', 'host-local'), true);
});
