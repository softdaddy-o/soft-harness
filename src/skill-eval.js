const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runAnalyze } = require('./analyze');
const { createBackup } = require('./backup');
const { exportInstructions } = require('./export');
const { exists, readJson, readUtf8, writeUtf8 } = require('./fs-util');
const { exportSettings } = require('./settings');
const { exportSkillsAndAgents } = require('./skills');
const { buildVirtualPc } = require('./virtual-pc');

async function runSkillEvals(options = {}) {
    const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..'));
    const fixture = await resolveAnalyzeEvalRoots(repoRoot, options);
    const accountRoot = fixture.accountRoot;
    const workspaceRoot = fixture.workspaceRoot;
    const checks = [];

    try {
        await collect(checks, 'analyze-contract', async () => evaluateAnalyzeContract(repoRoot));
        await collect(checks, 'analyze-virtual-pc-account', async () => evaluateAnalyzeVirtualPcAccount(accountRoot));
        await collect(checks, 'analyze-virtual-pc-workspace', async () => evaluateAnalyzeVirtualPcWorkspace(workspaceRoot));
        await collect(checks, 'organize-contract', async () => evaluateOrganizeContract(repoRoot));
        await collect(checks, 'organize-helper-flow', async () => evaluateOrganizeHelperFlow());
        await collect(checks, 'organize-dry-run-helper-flow', async () => evaluateOrganizeDryRunHelperFlow());

        return {
            repoRoot,
            virtualPcRoot: accountRoot,
            workspaceRoot,
            summary: {
                total: checks.length,
                passed: checks.filter((entry) => entry.ok).length,
                failed: checks.filter((entry) => !entry.ok).length
            },
            checks
        };
    } finally {
        if (typeof fixture.cleanup === 'function') {
            fixture.cleanup();
        }
    }
}

async function resolveAnalyzeEvalRoots(repoRoot, options) {
    const bundledAccountRoot = path.resolve(path.join(repoRoot, 'sandbox', 'virtual-pc', 'pc-image', 'C', 'Users', 'primary-user'));
    const bundledWorkspaceRoot = path.resolve(path.join(repoRoot, 'sandbox', 'virtual-pc', 'pc-image', 'F', 'src3', 'docs'));
    const requestedAccountRoot = options.virtualPcRoot
        ? path.resolve(options.virtualPcRoot)
        : bundledAccountRoot;
    const requestedWorkspaceRoot = options.workspaceRoot
        ? path.resolve(options.workspaceRoot)
        : bundledWorkspaceRoot;

    if ((options.virtualPcRoot || options.workspaceRoot) && !options.forceGeneratedVirtualPc) {
        return {
            accountRoot: requestedAccountRoot,
            workspaceRoot: requestedWorkspaceRoot,
            cleanup: null
        };
    }

    if (!options.forceGeneratedVirtualPc && exists(requestedAccountRoot) && exists(requestedWorkspaceRoot)) {
        return {
            accountRoot: requestedAccountRoot,
            workspaceRoot: requestedWorkspaceRoot,
            cleanup: null
        };
    }

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-skill-eval-vpc-'));
    try {
        const virtualPc = await buildAnalyzeEvalVirtualPc(fixtureRoot);
        return {
            accountRoot: virtualPc.homeImageRoot,
            workspaceRoot: virtualPc.docsImageRoot,
            cleanup() {
                fs.rmSync(fixtureRoot, { recursive: true, force: true });
            }
        };
    } catch (error) {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
        throw error;
    }
}

async function buildAnalyzeEvalVirtualPc(fixtureRoot) {
    const docsRoot = path.join(fixtureRoot, 'docs-source');
    const homeRoot = path.join(fixtureRoot, 'home-source');
    const outputRoot = path.join(fixtureRoot, 'virtual-pc');

    seedAnalyzeEvalSourceFixture(docsRoot, homeRoot);

    return buildVirtualPc({
        docsRoot,
        homeRoot,
        outputRoot,
        translateKorean: false
    });
}

function seedAnalyzeEvalSourceFixture(docsRoot, homeRoot) {
    writeUtf8(path.join(homeRoot, 'AGENTS.md'), '# Account Codex Notes\n\nKeep shared rules visible.\n');
    writeUtf8(path.join(homeRoot, '.claude', 'CLAUDE.md'), '# Account Claude Notes\n\nReview account prompts before reuse.\n');
    writeUtf8(path.join(homeRoot, '.claude', 'settings.json'), JSON.stringify({
        enabledPlugins: {
            'account-plugin@local': true
        },
        mcpServers: {
            accountShared: {
                command: 'node',
                args: ['account-mcp.js']
            }
        }
    }, null, 2));
    writeUtf8(path.join(homeRoot, '.codex', 'config.toml'), [
        'approval_policy = "never"',
        '',
        '[mcp_servers.account_shared]',
        'command = "node"',
        'args = ["account-mcp.js"]',
        '',
        '[[plugins]]',
        'name = "account-codex-plugin"',
        ''
    ].join('\n'));
    writeUtf8(path.join(homeRoot, '.claude', 'skills', 'account-review', 'SKILL.md'), [
        '---',
        'name: account-review',
        'description: Account-scoped review guidance.',
        '---',
        '',
        '# Account Review',
        '',
        'Use this skill to review account-level host drift.',
        ''
    ].join('\n'));
    writeUtf8(path.join(homeRoot, '.codex', 'agents', 'account-helper.md'), '# Account Helper\n\nSummarize host-only findings.\n');
    writeUtf8(path.join(homeRoot, '.gemini', 'settings.json'), JSON.stringify({
        enabledPlugins: {
            'gemini-account-plugin': true
        }
    }, null, 2));

    writeUtf8(path.join(docsRoot, 'AGENTS.md'), '# Workspace Codex Notes\n\nInspect repository-level drift carefully.\n');
    writeUtf8(path.join(docsRoot, '.claude', 'CLAUDE.md'), '# Workspace Claude Notes\n\nPrefer project-local findings.\n');
    writeUtf8(path.join(docsRoot, '.claude', 'settings.json'), JSON.stringify({
        enabledPlugins: {
            'workspace-plugin@local': true
        },
        mcpServers: {
            workspaceShared: {
                command: 'node',
                args: ['workspace-mcp.js']
            }
        }
    }, null, 2));
    writeUtf8(path.join(docsRoot, '.codex', 'config.toml'), [
        'approval_policy = "never"',
        '',
        '[mcp_servers.workspace_shared]',
        'command = "node"',
        'args = ["workspace-mcp.js"]',
        '',
        '[[plugins]]',
        'name = "workspace-codex-plugin"',
        ''
    ].join('\n'));
    writeUtf8(path.join(docsRoot, '.claude', 'skills', 'workspace-review', 'SKILL.md'), [
        '---',
        'name: workspace-review',
        'description: Workspace-scoped review guidance.',
        '---',
        '',
        '# Workspace Review',
        '',
        'Use this skill to review project-level host drift.',
        ''
    ].join('\n'));
    writeUtf8(path.join(docsRoot, '.claude', 'agents', 'workspace-helper.md'), '# Workspace Helper\n\nCapture repository findings.\n');
}

async function collect(checks, name, fn) {
    try {
        const details = await fn();
        checks.push({
            name,
            ok: true,
            details
        });
    } catch (error) {
        checks.push({
            name,
            ok: false,
            error: error && error.message ? error.message : String(error)
        });
    }
}

function evaluateAnalyzeContract(repoRoot) {
    const skill = readRepoFile(repoRoot, 'plugins/soft-harness/skills/analyze/SKILL.md');
    const agent = readRepoFile(repoRoot, 'plugins/soft-harness/skills/analyze/agents/openai.yaml');
    const rules = readRepoFile(repoRoot, 'plugins/soft-harness/skills/references/harness-folder-rules.md');
    const helper = readRepoFile(repoRoot, 'plugins/soft-harness/skills/references/helper-surface.md');

    expectMatch(skill, /never mutates host files/i, 'analyze skill must state host files are never mutated');
    expectMatch(skill, /--dry-run/i, 'analyze skill must document dry-run behavior');
    expectMatch(skill, /malformed MCP|parse-error/i, 'analyze skill must mention malformed MCP or parse errors');
    expectMatch(skill, /origin/i, 'analyze skill must mention origin research');
    expectMatch(skill, /Start with local evidence/i, 'analyze skill must start origin work from local evidence');
    expectMatch(skill, /GitHub|marketplace research/i, 'analyze skill must escalate to GitHub or marketplace research when local evidence is weak');
    expectMatch(skill, /If `?\.harness`? does not exist yet, treat that as normal/i, 'analyze skill must handle a missing .harness snapshot explicitly');
    expectMatch(agent, /without mutating host files/i, 'analyze skill chip must reinforce read-only behavior');
    expectMatch(agent, /missing \.harness as normal/i, 'analyze skill chip must mention missing .harness');
    expectMatch(rules, /\.harness\/`? is not the source of truth|\.harness\/ is not the source of truth/i, 'shared rules must say .harness is not authoritative');
    expectMatch(helper, /structured settings parsing, MCP extraction|settings files, including MCP inventories/i, 'helper surface must expose settings parsing');
    expectMatch(helper, /local origin hints/i, 'helper surface must expose local origin hints');
    expectMatch(helper, /src\/origins\.js`, `src\/asset-origins\.js`, `src\/plugin-origins\.js/i, 'helper surface must expose origin import helpers');

    return {
        checked: 13
    };
}

async function evaluateAnalyzeVirtualPcAccount(accountRoot) {
    expect(exists(accountRoot), `virtual PC account root not found: ${accountRoot}`);
    expect(!exists(path.join(accountRoot, '.harness')), 'virtual PC account root must not include a prebuilt .harness snapshot');

    const result = await runAnalyze(accountRoot, {});

    expect(result.inventory.documents.length >= 1, 'account analysis should discover at least one instruction document');
    expect(result.inventory.settings.length >= 1, 'account analysis should discover host settings');
    expect(result.inventory.skills.length >= 1, 'account analysis should discover host skills or agents');
    expect(result.inventory.plugins.hosts.length >= 1, 'account analysis should discover plugin host inventories');
    expect(Array.isArray(result.inventory.skillOrigins.llmPacket.assets), 'account analysis should expose a skill and agent origin research packet');
    expect(Array.isArray(result.inventory.plugins.llmPacket.plugins), 'account analysis should expose a plugin origin research packet');
    expect(result.summary.host_only >= 1, 'account analysis should surface host-only findings');
    expect(!exists(path.join(accountRoot, '.harness')), 'analyze eval must leave the account fixture without .harness');

    return {
        root: accountRoot,
        summary: result.summary,
        documents: result.inventory.documents.length,
        settings: result.inventory.settings.length,
        skills: result.inventory.skills.length,
        pluginHosts: result.inventory.plugins.hosts.length
    };
}

async function evaluateAnalyzeVirtualPcWorkspace(workspaceRoot) {
    expect(exists(workspaceRoot), `virtual PC workspace root not found: ${workspaceRoot}`);
    expect(!exists(path.join(workspaceRoot, '.harness')), 'virtual PC workspace root must not include a prebuilt .harness snapshot');

    const result = await runAnalyze(workspaceRoot, {});

    expect(result.inventory.documents.length >= 1, 'workspace analysis should discover instruction documents');
    expect(result.inventory.skills.length >= 1, 'workspace analysis should discover skills or agents');
    expect(result.inventory.plugins.hosts.length >= 1, 'workspace analysis should discover plugin host inventories');
    expect(Array.isArray(result.inventory.skillOrigins.llmPacket.assets), 'workspace analysis should expose a skill and agent origin research packet');
    expect(Array.isArray(result.inventory.plugins.llmPacket.plugins), 'workspace analysis should expose a plugin origin research packet');
    expect(result.summary.conflicts + result.summary.similar + result.summary.host_only >= 1, 'workspace analysis should surface non-empty findings');
    expect(!exists(path.join(workspaceRoot, '.harness')), 'analyze eval must leave the workspace fixture without .harness');

    return {
        root: workspaceRoot,
        summary: result.summary,
        documents: result.inventory.documents.length,
        skills: result.inventory.skills.length,
        pluginHosts: result.inventory.plugins.hosts.length
    };
}

function evaluateOrganizeContract(repoRoot) {
    const skill = readRepoFile(repoRoot, 'plugins/soft-harness/skills/organize/SKILL.md');
    const agent = readRepoFile(repoRoot, 'plugins/soft-harness/skills/organize/agents/openai.yaml');
    const helper = readRepoFile(repoRoot, 'plugins/soft-harness/skills/references/helper-surface.md');
    const rules = readRepoFile(repoRoot, 'plugins/soft-harness/skills/references/harness-folder-rules.md');

    expectMatch(skill, /Parse the user's natural-language intent/i, 'organize skill must accept natural-language requests');
    expectMatch(skill, /Update the real host files/i, 'organize skill must prioritize host-file changes');
    expectMatch(skill, /back up displaced host files first/i, 'organize skill must require backups before replacement');
    expectMatch(skill, /malformed MCP/i, 'organize skill must mention malformed MCP detection');
    expectMatch(skill, /Propose optimizations/i, 'organize skill must mention optimization suggestions');
    expectMatch(skill, /\.harness\/memory\//i, 'organize skill must route durable memory into .harness/memory/');
    expectMatch(skill, /--dry-run/i, 'organize skill must document dry-run behavior');
    expectMatch(skill, /If `?\.harness`? does not exist yet, treat that as normal/i, 'organize skill must handle a missing .harness snapshot explicitly');
    expectMatch(agent, /change the real host configs/i, 'organize skill chip must mention live host changes');
    expectMatch(agent, /missing \.harness as normal/i, 'organize skill chip must mention missing .harness');
    expectMatch(helper, /apply organized settings back to host files/i, 'helper surface must expose settings apply helpers');
    expectMatch(helper, /backing up displaced host files before replacement/i, 'helper surface must expose backup behavior');
    expectMatch(rules, /host files as the live truth/i, 'shared rules must reiterate host-authoritative state');

    return {
        checked: 13
    };
}

function evaluateOrganizeHelperFlow() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-skill-eval-'));
    try {
        seedOrganizeEvalFixture(root);

        const backup = createBackup(root, [
            'CLAUDE.md',
            '.claude/CLAUDE.md',
            'AGENTS.md',
            '.claude/settings.json',
            '.codex/config.toml',
            '.claude/skills/reviewer-kit',
            '.claude/agents/reviewer.md'
        ], { reason: 'skill-eval-organize' });

        const instructionExport = exportInstructions(root, {});
        const settingsExport = exportSettings(root, {});
        const assetExport = exportSkillsAndAgents(root, {});

        const claudeRoot = readUtf8(path.join(root, 'CLAUDE.md'));
        const claudeNested = readUtf8(path.join(root, '.claude', 'CLAUDE.md'));
        const codexRoot = readUtf8(path.join(root, 'AGENTS.md'));
        const claudeSettings = readJson(path.join(root, '.claude', 'settings.json'));
        const codexConfig = readUtf8(path.join(root, '.codex', 'config.toml'));
        const backupManifest = readJson(path.join(backup.backupDir, 'manifest.json'));

        expectMatch(claudeRoot, /@\.harness\/HARNESS\.md/, 'Claude root instruction should become an import stub');
        expectMatch(claudeRoot, /@\.harness\/memory\/shared\.md/, 'Claude root instruction should include shared memory');
        expectMatch(claudeNested, /@\.harness\/llm\/claude\.md/, 'Nested Claude instruction should include the host-specific snapshot');
        expectMatch(codexRoot, /Shared guidance/, 'Codex root instruction should render shared snapshot content');
        expectMatch(codexRoot, /Always summarize risky MCP changes/, 'Codex root instruction should render shared memory content');
        expect(claudeSettings.approval_policy === 'never', 'Claude JSON export should preserve unrelated keys');
        expect(claudeSettings.mcpServers.shared, 'Claude JSON export should include shared MCP state');
        expect(claudeSettings.mcpServers.claudeLocal, 'Claude JSON export should include host-local MCP state');
        expectMatch(codexConfig, /approval_policy = "never"/, 'Codex TOML export should preserve unrelated keys');
        expectMatch(codexConfig, /\[mcp_servers\.shared\]/, 'Codex TOML export should include shared MCP state');
        expectMatch(codexConfig, /\[mcp_servers\.codexLocal\]/, 'Codex TOML export should include host-local MCP state');
        expect(exists(path.join(root, '.claude', 'skills', 'reviewer-kit', 'SKILL.md')), 'Common skill snapshot should export to Claude');
        expect(exists(path.join(root, '.codex', 'skills', 'reviewer-kit', 'SKILL.md')), 'Common skill snapshot should export to Codex');
        expect(exists(path.join(root, '.claude', 'agents', 'reviewer.md')), 'Markdown agent snapshot should export to Claude');
        expect(exists(path.join(root, '.codex', 'agents', 'reviewer.yaml')), 'Codex YAML agent snapshot should export to Codex');
        expect(backupManifest.entries.length >= 5, 'Organize helper flow should create a backup manifest for displaced host files');

        return {
            root,
            backup: backup.timestamp,
            instructionExports: instructionExport.exported.length,
            settingsExports: settingsExport.exported.length,
            assetExports: assetExport.exported.length
        };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function evaluateOrganizeDryRunHelperFlow() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-skill-eval-dryrun-'));
    try {
        seedOrganizeEvalFixture(root);

        const before = {
            claudeRoot: readUtf8(path.join(root, 'CLAUDE.md')),
            claudeNested: readUtf8(path.join(root, '.claude', 'CLAUDE.md')),
            codexRoot: readUtf8(path.join(root, 'AGENTS.md')),
            claudeSettings: readUtf8(path.join(root, '.claude', 'settings.json')),
            codexConfig: readUtf8(path.join(root, '.codex', 'config.toml'))
        };

        const instructionExport = exportInstructions(root, { dryRun: true });
        const settingsExport = exportSettings(root, { dryRun: true });
        const assetExport = exportSkillsAndAgents(root, { dryRun: true });

        expect(instructionExport.exported.length >= 1, 'Organize dry-run should still plan instruction exports');
        expect(settingsExport.exported.length >= 1, 'Organize dry-run should still plan settings exports');
        expect(assetExport.exported.length >= 1, 'Organize dry-run should still plan skill or agent exports');

        expect(readUtf8(path.join(root, 'CLAUDE.md')) === before.claudeRoot, 'Organize dry-run must not rewrite root Claude instructions');
        expect(readUtf8(path.join(root, '.claude', 'CLAUDE.md')) === before.claudeNested, 'Organize dry-run must not rewrite nested Claude instructions');
        expect(readUtf8(path.join(root, 'AGENTS.md')) === before.codexRoot, 'Organize dry-run must not rewrite Codex instructions');
        expect(readUtf8(path.join(root, '.claude', 'settings.json')) === before.claudeSettings, 'Organize dry-run must not rewrite Claude settings');
        expect(readUtf8(path.join(root, '.codex', 'config.toml')) === before.codexConfig, 'Organize dry-run must not rewrite Codex settings');
        expect(!exists(path.join(root, '.harness', 'backups')), 'Organize dry-run must not create backups');

        return {
            root,
            plannedInstructionExports: instructionExport.exported.length,
            plannedSettingsExports: settingsExport.exported.length,
            plannedAssetExports: assetExport.exported.length
        };
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function seedOrganizeEvalFixture(root) {
    writeUtf8(path.join(root, '.harness', 'HARNESS.md'), '# Shared guidance\n\nUse organize for coordinated host changes.\n');
    writeUtf8(path.join(root, '.harness', 'memory', 'shared.md'), '# Recorded memory\n\n- Always summarize risky MCP changes.\n');
    writeUtf8(path.join(root, '.harness', 'llm', 'claude.md'), '# Claude host notes\n\nKeep Claude review prompts concise.\n');
    writeUtf8(path.join(root, '.harness', 'llm', 'codex.md'), '# Codex host notes\n\nPrefer direct code diffs.\n');
    writeUtf8(path.join(root, '.harness', 'settings', 'portable.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  shared:',
        '    transport: stdio',
        '    command: node',
        '    args: [shared.js]',
        '    enabled_for: [claude, codex]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'settings', 'llm', 'claude.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  claudeLocal:',
        '    command: node',
        '    args: [claude.js]',
        '    enabled_for: [claude]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'settings', 'llm', 'codex.yaml'), [
        'version: 1',
        'mcp_servers:',
        '  codexLocal:',
        '    command: node',
        '    args: [codex.js]',
        '    enabled_for: [codex]',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'skills', 'common', 'reviewer-kit', 'SKILL.md'), [
        '---',
        'name: reviewer-kit',
        'description: Shared reviewer guidance for host exports.',
        '---',
        '',
        '# Reviewer Kit',
        '',
        'Use this skill when review scaffolding is needed.',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.harness', 'agents', 'common', 'reviewer.md'), '# Reviewer\n\nSummarize issues and next actions.\n');
    writeUtf8(path.join(root, '.harness', 'agents', 'codex', 'reviewer.yaml'), [
        'interface:',
        '  display_name: "Reviewer"',
        '  short_description: "Summarize issues and next actions."',
        '  default_prompt: "Review the work, summarize the issues, and explain the next actions clearly."',
        ''
    ].join('\n'));

    writeUtf8(path.join(root, 'CLAUDE.md'), '# Previous Claude Root\n\nLegacy content.\n');
    writeUtf8(path.join(root, '.claude', 'CLAUDE.md'), '# Previous Nested Claude\n\nLegacy content.\n');
    writeUtf8(path.join(root, 'AGENTS.md'), '# Previous Codex Root\n\nLegacy content.\n');
    writeUtf8(path.join(root, '.claude', 'settings.json'), JSON.stringify({
        approval_policy: 'never',
        mcpServers: {
            stale: {
                command: 'old'
            }
        }
    }, null, 2));
    writeUtf8(path.join(root, '.codex', 'config.toml'), [
        'approval_policy = "never"',
        '',
        '[mcp_servers.stale]',
        'command = "old"',
        ''
    ].join('\n'));
    writeUtf8(path.join(root, '.claude', 'skills', 'reviewer-kit', 'SKILL.md'), '# stale reviewer skill\n');
    writeUtf8(path.join(root, '.claude', 'agents', 'reviewer.md'), '# stale reviewer agent\n');
}

function expect(value, message) {
    if (!value) {
        throw new Error(message);
    }
}

function expectMatch(text, pattern, message) {
    if (!pattern.test(text)) {
        throw new Error(message);
    }
}

function readRepoFile(repoRoot, relativePath) {
    return readUtf8(path.join(repoRoot, relativePath));
}

module.exports = {
    runSkillEvals
};
