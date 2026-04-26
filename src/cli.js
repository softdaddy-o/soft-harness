#!/usr/bin/env node

const path = require('node:path');
const { listBackups } = require('./backup');
const { DEFAULT_BODY_THRESHOLD, DEFAULT_HEADING_THRESHOLD } = require('./section-match');

const HELP = `soft-harness - internal deterministic helpers for the soft-harness plugin

Active user workflow lives in the plugin skills:
  analyze                           Read-only inspection and snapshot refresh
  organize                          Natural-language host maintenance plus snapshot refresh

Commands:
  soft-harness sync [options]         Legacy reconcile helper during plugin migration
  soft-harness analyze [options]      Debug analysis for prompts, settings, skills, and plugins
  soft-harness plugins import-origins [opts]
                                      Save LLM-found plugin origins into .harness/ (debug helper)
  soft-harness origins import [opts]  Save LLM-found skill/agent origins into .harness/ (debug helper)
  soft-harness prompt --analyze       Print the legacy origin-research prompt (debug helper)
  soft-harness remember [options]     Internal memory helper that refreshes derived instruction files
  soft-harness revert --list          List available backups created by helper flows
  soft-harness revert <timestamp>     Restore files from a backup created by helper flows
  soft-harness help                   Show this message

Sync options:
  --root=<path>                      Run against an explicit root instead of the current directory
  --account                          Run against the current account home directory
  --manual-review                    Confirm extraction and conflict decisions
  --dry-run                          Report planned changes and write nothing
  --verbose                          Show file-level sync details
  --explain                          Show routing reasons and merge details
  --heading-threshold=<0..1>         Heading similarity threshold for near-match routing (default: ${DEFAULT_HEADING_THRESHOLD})
  --body-threshold=<0..1>            Body similarity threshold for near-match routing (default: ${DEFAULT_BODY_THRESHOLD})
  --yes                              Auto-approve first-sync review prompts
  --no-import                        Skip project -> .harness import and pull-back
  --no-export                        Skip .harness -> project export
  --link-mode=<mode>                 Export skill/agent links using copy, symlink, or junction
  --force-export-untracked-hosts     Allow repo-internal link exports even when target paths are not gitignored

Analyze options:
  --root=<path>                      Analyze an explicit root instead of the current directory
  --account                          Analyze the current account home directory
  --include-account                  Include account-level Codex settings while analyzing a project
  --account-root=<path>              Account home to use with --include-account
  --category=<name>                  Analyze prompts, settings, skills, plugins, or all
  --llms=<names>                     Limit analysis to a comma-separated llm list
  --verbose                          Show file-level analysis details
  --explain                          Show classification reasons
  --heading-threshold=<0..1>         Heading similarity threshold for cross-host section matching (default: ${DEFAULT_HEADING_THRESHOLD})
  --body-threshold=<0..1>            Body similarity threshold for cross-host section matching (default: ${DEFAULT_BODY_THRESHOLD})
  --json                             Emit JSON instead of text

Origin import options:
  --root=<path>                      Save origins under an explicit root instead of the current directory
  --account                          Save origins under the current account home directory
  --input=<path>                     Read LLM-found origin data from JSON or YAML

Prompt options:
  --analyze                          Print the origin resolution workflow prompt
  --account                          Use account-scoped commands in the generated prompt
  --no-web                           Tell the LLM not to use web research

Remember options:
  --scope=<project|account>          Write to the project .harness/ or the account home .harness/
  --llm=<shared|claude|codex|gemini> Choose the shared or per-LLM memory destination
  --section=<name>                   Store the entry under this section heading
  --title=<name>                     Entry title to create or update
  --content=<text>                   Entry body content
  --no-export                        Update harness truth without regenerating host outputs
`;

const ICONS = {
    analyze: '📊',
    common: '✅ Common',
    completed: '✅',
    conflicts: '⚠️ Conflicts',
    documents: '📄 Documents',
    hostOnly: '📁 Host Only',
    settings: '⚙️ Settings',
    similar: '🔀 Similar',
    syncPlan: '📦',
    unknown: '❓ Unknown'
};

function parseSyncArgs(args) {
    const flags = new Set(args);
    const linkModeArg = args.find((arg) => arg.startsWith('--link-mode='));
    const linkMode = linkModeArg ? linkModeArg.split('=')[1] : 'copy';
    const root = parseCommandRootArgs(args);
    const thresholds = parseThresholdArgs(args);
    if (!['copy', 'symlink', 'junction'].includes(linkMode)) {
        throw new Error(`invalid --link-mode: ${linkMode}`);
    }

    return {
        account: flags.has('--account'),
        bodyThreshold: thresholds.bodyThreshold,
        dryRun: flags.has('--dry-run') || flags.has('-n'),
        explain: flags.has('--explain'),
        forceExportUntrackedHosts: flags.has('--force-export-untracked-hosts'),
        headingThreshold: thresholds.headingThreshold,
        linkMode,
        manualReview: flags.has('--manual-review') || flags.has('-i'),
        noImport: flags.has('--no-import'),
        noExport: flags.has('--no-export'),
        noRunInstalls: flags.has('--no-run-installs'),
        noRunUninstalls: flags.has('--no-run-uninstalls'),
        root,
        verbose: flags.has('--verbose') || flags.has('--explain'),
        yes: flags.has('--yes')
    };
}

function parseAnalyzeArgs(args) {
    const flags = new Set(args);
    const categoryArg = args.find((arg) => arg.startsWith('--category='));
    const llmsArg = args.find((arg) => arg.startsWith('--llms='));
    const accountRootArg = args.find((arg) => arg.startsWith('--account-root='));
    const root = parseCommandRootArgs(args);
    const thresholds = parseThresholdArgs(args);
    const category = categoryArg ? categoryArg.split('=')[1] : 'all';
    if (!['all', 'prompts', 'settings', 'skills', 'plugins'].includes(category)) {
        throw new Error(`invalid --category: ${category}`);
    }

    const llms = llmsArg
        ? llmsArg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)
        : [];
    const accountRoot = parseAccountRootArg(accountRootArg);

    return {
        account: flags.has('--account'),
        accountRoot,
        bodyThreshold: thresholds.bodyThreshold,
        category,
        explain: flags.has('--explain'),
        headingThreshold: thresholds.headingThreshold,
        includeAccount: flags.has('--include-account') || Boolean(accountRoot),
        json: flags.has('--json'),
        llms,
        root,
        verbose: flags.has('--verbose')
    };
}

async function runSync(args, io) {
    const { runSync: runSyncImpl } = require('./sync');
    let syncOptions;
    try {
        syncOptions = parseSyncArgs(args);
    } catch (error) {
        process.stderr.write(`sync failed: ${error.message}\n`);
        return 1;
    }
    syncOptions.interactive = !syncOptions.yes && Boolean(process.stdin.isTTY && process.stdout.isTTY);

    const rootDir = resolveCommandRoot(process.cwd(), syncOptions);
    const result = await runSyncImpl(rootDir, syncOptions, io);

    process.stdout.write(formatSyncReport(result, syncOptions));
    return 0;
}

async function runAnalyze(args) {
    const { runAnalyze: runAnalyzeImpl } = require('./analyze');
    let analyzeOptions;
    try {
        analyzeOptions = parseAnalyzeArgs(args);
    } catch (error) {
        process.stderr.write(`analyze failed: ${error.message}\n`);
        return 1;
    }

    try {
        if (analyzeOptions.includeAccount && !analyzeOptions.accountRoot) {
            analyzeOptions.accountRoot = resolveCommandRoot(process.cwd(), { account: true });
        }
        const rootDir = resolveCommandRoot(process.cwd(), analyzeOptions);
        const result = await runAnalyzeImpl(rootDir, analyzeOptions);
        const report = analyzeOptions.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : formatAnalyzeReport(result, analyzeOptions);
        process.stdout.write(report);
        return 0;
    } catch (error) {
        process.stderr.write(`analyze failed: ${error.message}\n`);
        return 1;
    }
}

function runCurate(args) {
    const { parseCurateArgs, runCurate: runCurateImpl } = require('./curate');
    let curateOptions;
    try {
        curateOptions = parseCurateArgs(args);
    } catch (error) {
        process.stderr.write(`curate failed: ${error.message}\n`);
        return 1;
    }

    try {
        const rootDir = resolveCommandRoot(process.cwd(), curateOptions);
        const result = runCurateImpl(rootDir, curateOptions);
        process.stdout.write(formatCurateReport(result));
        return 0;
    } catch (error) {
        process.stderr.write(`curate failed: ${error.message}\n`);
        return 1;
    }
}

function runPlugins(args) {
    const subcommand = args[0] || '';
    if (subcommand !== 'import-origins') {
        process.stderr.write(`plugins failed: unsupported plugins command: ${subcommand || '(missing)'}\n`);
        return 1;
    }

    const { parseCurateArgs, runCurate: runCurateImpl } = require('./curate');
    let pluginOptions;
    try {
        pluginOptions = parseCurateArgs(['plugins', ...args.slice(1)]);
    } catch (error) {
        process.stderr.write(`plugins import-origins failed: ${error.message}\n`);
        return 1;
    }

    try {
        const rootDir = resolveCommandRoot(process.cwd(), pluginOptions);
        const result = runCurateImpl(rootDir, pluginOptions);
        process.stdout.write(formatCurateReport(result));
        return 0;
    } catch (error) {
        process.stderr.write(`plugins import-origins failed: ${error.message}\n`);
        return 1;
    }
}

function runOrigins(args) {
    const subcommand = args[0] || '';
    if (subcommand !== 'import') {
        process.stderr.write(`origins failed: unsupported origins command: ${subcommand || '(missing)'}\n`);
        return 1;
    }

    const { importOrigins, parseOriginsArgs } = require('./origins');
    let originOptions;
    try {
        originOptions = parseOriginsArgs(args.slice(1));
    } catch (error) {
        process.stderr.write(`origins import failed: ${error.message}\n`);
        return 1;
    }

    try {
        const rootDir = resolveCommandRoot(process.cwd(), originOptions);
        const result = importOrigins(rootDir, originOptions);
        process.stdout.write(formatCurateReport(result));
        return 0;
    } catch (error) {
        process.stderr.write(`origins import failed: ${error.message}\n`);
        return 1;
    }
}

function runPrompt(args) {
    const { buildPrompt, parsePromptArgs } = require('./llm-prompt');
    let promptOptions;
    try {
        promptOptions = parsePromptArgs(args);
    } catch (error) {
        process.stderr.write(`prompt failed: ${error.message}\n`);
        return 1;
    }

    process.stdout.write(`${buildPrompt(promptOptions)}\n`);
    return 0;
}

function runRemember(args) {
    const { parseRememberArgs, runRemember: runRememberImpl } = require('./remember');
    let rememberOptions;
    try {
        rememberOptions = parseRememberArgs(args);
    } catch (error) {
        process.stderr.write(`remember failed: ${error.message}\n`);
        return 1;
    }

    try {
        const result = runRememberImpl(process.cwd(), rememberOptions);
        process.stdout.write(formatRememberReport(result));
        return 0;
    } catch (error) {
        process.stderr.write(`remember failed: ${error.message}\n`);
        return 1;
    }
}

function runRevert(args) {
    const { runRevert: runRevertImpl } = require('./revert');
    if (args.includes('--list')) {
        const backups = listBackups(process.cwd());
        if (backups.length === 0) {
            process.stdout.write('No backups available.\n');
            return 0;
        }

        for (const backup of backups) {
            process.stdout.write(`${backup.timestamp} files=${backup.fileCount} reason=${backup.reason || 'sync'}\n`);
        }
        return 0;
    }

    const timestamp = args.find((arg) => !arg.startsWith('--'));
    if (!timestamp) {
        process.stderr.write('revert requires --list or a timestamp\n');
        return 1;
    }

    try {
        const result = runRevertImpl(process.cwd(), { timestamp });
        process.stdout.write(`reverted ${result.timestamp} restored=${result.restoredCount}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`revert failed: ${error.message}\n`);
        return 1;
    }
}

async function main(argv, io) {
    const command = argv[2] || 'help';

    switch (command) {
        case 'help':
        case '--help':
        case '-h':
            process.stdout.write(HELP);
            return 0;
        case 'sync':
            return runSync(argv.slice(3), io);
        case 'analyze':
            return runAnalyze(argv.slice(3));
        case 'curate':
            return runCurate(argv.slice(3));
        case 'plugins':
            return runPlugins(argv.slice(3));
        case 'origins':
            return runOrigins(argv.slice(3));
        case 'prompt':
            return runPrompt(argv.slice(3));
        case 'remember':
            return runRemember(argv.slice(3));
        case 'revert':
            return runRevert(argv.slice(3));
        default:
            process.stderr.write(`unknown command: ${command}\n${HELP}`);
            return 1;
    }
}

if (require.main === module) {
    main(process.argv).then((code) => process.exit(code));
}

module.exports = {
    HELP,
    __private: {
        buildSectionTreeItems,
        collapseLeadingLevelOne,
        formatImportDetails,
        resolveCommandRoot
    },
    formatAnalyzeReport,
    formatCurateReport,
    formatRememberReport,
    formatSyncReport,
    main,
    parseAnalyzeArgs,
    parseSyncArgs
};

function parseCommandRootArgs(args) {
    const rootArg = args.find((arg) => arg.startsWith('--root='));
    const root = rootArg ? rootArg.slice('--root='.length).trim() : '';
    const account = args.includes('--account');
    if (root && account) {
        throw new Error('cannot combine --root and --account');
    }
    if (rootArg && !root) {
        throw new Error('--root requires a path');
    }
    return root || null;
}

function parseAccountRootArg(arg) {
    if (!arg) {
        return null;
    }
    const root = arg.slice('--account-root='.length).trim();
    if (!root) {
        throw new Error('--account-root requires a path');
    }
    return path.resolve(root);
}

function parseThresholdArgs(args) {
    const headingArg = args.find((arg) => arg.startsWith('--heading-threshold='));
    const bodyArg = args.find((arg) => arg.startsWith('--body-threshold='));
    return {
        headingThreshold: parseThresholdValue(headingArg, '--heading-threshold', DEFAULT_HEADING_THRESHOLD),
        bodyThreshold: parseThresholdValue(bodyArg, '--body-threshold', DEFAULT_BODY_THRESHOLD)
    };
}

function parseThresholdValue(arg, label, fallback) {
    if (!arg) {
        return fallback;
    }
    const value = arg.slice(`${label}=`.length).trim();
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
        throw new Error(`${label} must be between 0 and 1`);
    }
    return numeric;
}

function resolveCommandRoot(baseDir, options) {
    if (options && options.root) {
        return path.resolve(options.root);
    }
    if (options && options.account) {
        const homeDir = process.env.USERPROFILE || process.env.HOME;
        if (!homeDir) {
            throw new Error('account mode requires HOME or USERPROFILE');
        }
        return path.resolve(homeDir);
    }
    return path.resolve(baseDir);
}

function formatSyncReport(result, options) {
    const lines = [];
    if (result.phase === 'dry-run') {
        lines.push(`${ICONS.syncPlan} import=${result.plan.import.length}  export=${result.plan.export.length}  drift=${result.plan.drift.length}  conflicts=${result.plan.conflicts.length}`);
        appendSyncDryRunPlan(lines, result.details, options);
    } else {
        lines.push(`${ICONS.completed} imported=${result.imported.length}  exported=${result.exported.length}  pulled_back=${result.pulledBack.length}`);
        if (result.backupTs) {
            lines.push(`backup: ${result.backupTs}`);
        }
        appendSection(lines, 'exports', formatExportDetails(result.details && result.details.exports, options));
        appendSection(lines, 'drift', formatDriftDetails(result.details && result.details.drift));
        appendSection(lines, 'conflicts', formatConflictDetails(result.details && result.details.conflicts));
    }

    if (result.pluginActions && result.pluginActions.length > 0) {
        lines.push('');
        lines.push('plugins');
        appendTreeItems(lines, result.pluginActions.map((action) => ({
            text: `${action.status}: ${action.name}${action.version ? `@${action.version}` : ''}`
        })));
    }

    return `${lines.join('\n')}\n`;
}

function appendSection(lines, label, entries) {
    if (!entries || entries.length === 0) {
        return;
    }

    lines.push('');
    lines.push(label);
    appendTreeItems(lines, entries.map((entry) => ({ text: entry })));
}

function appendTreeSection(lines, label, items) {
    if (!items || items.length === 0) {
        return;
    }

    lines.push('');
    lines.push(label);
    appendTreeItems(lines, items);
}

function formatImportDetails(entries, options) {
    const items = [];
    for (const entry of entries || []) {
        if (entry.action === 'adopt') {
            items.push(`${entry.from} -> ${entry.to}`);
            continue;
        }
        if (entry.action === 'extract-common') {
            const sourceList = Array.isArray(entry.from) ? entry.from.join(', ') : entry.from;
            items.push(`section "${entry.heading || '(untitled)'}" from ${sourceList} -> ${entry.to}`);
            continue;
        }
        if (entry.action === 'extract-specific') {
            items.push(`section "${entry.heading || '(untitled)'}" from ${entry.from} -> ${entry.to}`);
            continue;
        }
        if (entry.action === 'maybe-common' && options && options.explain) {
            const bodyScore = typeof entry.similarity === 'number' ? entry.similarity.toFixed(2) : 'n/a';
            const headingScore = typeof entry.headingSimilarity === 'number' ? entry.headingSimilarity.toFixed(2) : 'n/a';
            items.push(`section "${entry.heading || '(untitled)'}" left LLM-specific (near match across ${entry.llms.join(', ')}, body ${bodyScore}, heading ${headingScore})`);
            continue;
        }
        if (entry.action === 'bucket') {
            const reason = options && options.explain ? ` (${entry.reason})` : '';
            items.push(`${entry.type} "${entry.name}" ${entry.from} -> ${entry.to}${reason}`);
        }
    }
    return items;
}

function formatExportDetails(entries, options) {
    const items = [];
    for (const entry of entries || []) {
        if (entry.action === 'export-instruction') {
            items.push(`${entry.from.join(' + ')} -> ${entry.to}`);
            continue;
        }
        if (entry.action === 'export') {
            const reason = options && options.explain && entry.reason ? ` (${entry.reason})` : '';
            items.push(`${entry.from} -> ${entry.to} [${entry.mode}]${reason}`);
        }
    }
    return items;
}

function formatDriftDetails(entries) {
    return (entries || []).map((entry) => {
        if (entry.relativePath) {
            return `${entry.type}: ${entry.relativePath}`;
        }
        return `${entry.type}: ${entry.target}`;
    });
}

function formatConflictDetails(entries) {
    return (entries || []).map((entry) => `${entry.type}: ${entry.relativePath}`);
}

function formatAnalyzeReport(result, options) {
    const lines = [];
    if (typeof result.score === 'number') {
        const reasons = Array.isArray(result.score_reasons) ? result.score_reasons.filter(Boolean) : [];
        const reasonText = reasons.length > 0
            ? ` - ${reasons.join('; ')}`
            : '';
        lines.push(`score: ${result.score}/100${reasonText}`);
    }
    lines.push(`${ICONS.analyze} common=${result.summary.common}  similar=${result.summary.similar}  conflicts=${result.summary.conflicts}  host_only=${result.summary.host_only}  unknown=${result.summary.unknown}`);

    appendTreeSection(lines, ICONS.documents, formatAnalyzeDocuments(result, options));
    appendTreeSection(lines, ICONS.settings, formatAnalyzeSettings(result.inventory && result.inventory.settings));
    appendTreeSection(lines, '🧰 Skills', formatAnalyzeSkills(result, options));
    appendTreeSection(lines, '🧩 Plugins', formatAnalyzePlugins(result, options));

    if (shouldShowAnalyzeBuckets(result, options)) {
        if (options && options.verbose) {
            appendAnalyzeBucket(lines, ICONS.common, 'same content', result.common, options);
        }
        appendAnalyzeBucket(lines, ICONS.similar, 'same or similar heading, similar content', result.similar, options);
        appendAnalyzeBucket(lines, ICONS.conflicts, 'same or similar heading, conflicting content', result.conflicts, options);
        if (options && options.verbose) {
            appendAnalyzeBucket(lines, ICONS.hostOnly, 'present on only one host', result.host_only, options);
        }
        appendAnalyzeBucket(lines, ICONS.unknown, 'unable to classify automatically', result.unknown, options);
    }

    return `${lines.join('\n')}\n`;
}

function formatAnalyzeDocuments(result, options) {
    const annotations = buildPromptAnnotations(result);
    const entries = result && result.inventory && result.inventory.documents;
    return (entries || []).map((entry) => {
        const headings = entry.headings !== undefined
            ? entry.headings
            : Array.isArray(entry.sectionHeadings) ? entry.sectionHeadings.length : 0;
        const sections = Array.isArray(entry.sections)
            ? entry.sections
            : Array.isArray(entry.sectionHeadings)
                ? entry.sectionHeadings.map((heading) => ({ heading, level: 1 }))
                : [];
        const children = [
            { text: `source${entry.sourceFiles && entry.sourceFiles.length > 1 ? 's' : ''}: ${(entry.sourceFiles || []).join(', ') || entry.file}` },
            { text: `headings: ${headings}` }
        ];
        if (entry.untitledCount > 0) {
            children.push({ text: `untitled blocks: ${entry.untitledCount}` });
        }
        if (sections.length > 0) {
            children.push({
                text: 'sections',
                children: buildDocumentSectionTreeItems(sections, entry, annotations, options)
            });
        }
        return {
            text: `file: ${entry.llm}:${entry.file} [${entry.mode}]`,
            children
        };
    });
}

function formatAnalyzeSettings(entries) {
    return (entries || []).map((entry) => {
        const mcpServers = entry.mcpServers || [];
        const mcpOverrides = entry.mcpOverrides || [];
        const hostOnlyKeys = entry.hostOnlyKeys || [];
        const children = [
            { text: `mcp servers: ${mcpServers.length}` },
            { text: `mcp overrides: ${mcpOverrides.length}` },
            { text: `host-only keys: ${hostOnlyKeys.length}` }
        ];
        if (entry.scope) {
            children.unshift({ text: `scope: ${entry.scope}` });
        }
        if (mcpServers.length > 0) {
            children.push({
                text: 'servers',
                children: mcpServers.map((server) => ({ text: `server: ${server}` }))
            });
        }
        if (mcpOverrides.length > 0) {
            children.push({
                text: 'overrides',
                children: mcpOverrides.map((server) => ({ text: `override: ${server}` }))
            });
        }
        if (hostOnlyKeys.length > 0) {
            children.push({
                text: 'keys',
                children: hostOnlyKeys.map((key) => ({ text: `key: ${key}` }))
            });
        }
        if (entry.error) {
            children.push({ text: `error: ${entry.error}` });
        }
        return {
            text: `file: ${entry.llm}:${entry.file} [${entry.format}/${entry.status}]`,
            children
        };
    });
}

function formatAnalyzeSkills(result, options) {
    const entries = result && result.inventory && result.inventory.skills;
    const originAssets = (result && result.inventory && result.inventory.skillOrigins
        && result.inventory.skillOrigins.llmPacket && result.inventory.skillOrigins.llmPacket.assets) || [];
    const annotations = buildCategoryAnnotations(result, 'skills');
    const items = [];

    if (originAssets.length > 0) {
        items.push({
            text: 'research packet',
            children: originAssets.map((asset) => formatAnalyzeAssetOriginEntry(asset, options))
        });
    }

    for (const entry of entries || []) {
        const children = [
            { text: `skills: ${entry.skills.length}` },
            { text: `agents: ${entry.agents.length}` }
        ];
        if (entry.skills.length > 0) {
            children.push({
                text: 'skill entries',
                children: entry.skills.map((name) => ({
                    text: `skill: ${name}${formatInventoryAnnotation(annotations, `skills.skill:${name}`, entry.llm, name, options)}`
                }))
            });
        }
        if (entry.agents.length > 0) {
            children.push({
                text: 'agent entries',
                children: entry.agents.map((name) => ({
                    text: `agent: ${name}${formatInventoryAnnotation(annotations, `skills.agent:${name}`, entry.llm, name, options)}`
                }))
            });
        }
        items.push({
            text: `host: ${entry.llm}`,
            children
        });
    }

    return items;
}

function formatAnalyzeAssetOriginEntry(asset, options) {
    const status = asset.needs_origin_research ? 'origin missing' : 'origin saved';
    const item = {
        text: `${asset.kind}: ${asset.name} [${asset.host}; ${status}]`,
        children: []
    };

    if (!(options && options.explain)) {
        return item;
    }

    const details = [];
    if (asset.source_type) {
        details.push({ text: `source: ${asset.source_type}` });
    }
    if (asset.repo) {
        details.push({ text: `repo: ${asset.repo}` });
    }
    if (asset.url) {
        details.push({ text: `url: ${asset.url}` });
    }
    if (asset.source_path) {
        details.push({ text: `source path: ${asset.source_path}` });
    }
    if (asset.installed_version) {
        details.push({ text: `installed version: ${asset.installed_version}` });
    }
    if (asset.latest_version) {
        details.push({ text: `latest version: ${asset.latest_version}` });
    }
    if (asset.git_commit_sha) {
        details.push({ text: `git commit: ${asset.git_commit_sha}` });
    }
    if (asset.confidence) {
        details.push({ text: `origin confidence: ${asset.confidence}` });
    }
    if (asset.evidence) {
        details.push({ text: `evidence: ${asset.evidence}` });
    }
    if (asset.notes) {
        details.push({ text: `origin notes: ${asset.notes}` });
    }
    item.children = details;
    return item;
}

function formatAnalyzePlugins(result, options) {
    const inventory = result && result.inventory && result.inventory.plugins;
    const desired = (inventory && inventory.desired) || [];
    const llmPacket = (inventory && inventory.llmPacket && inventory.llmPacket.plugins) || [];
    const hosts = (inventory && inventory.hosts) || [];
    const annotations = buildCategoryAnnotations(result, 'plugins');
    const items = [];

    if (desired.length > 0) {
        items.push({
            text: 'desired plugins',
            children: desired.map((plugin) => ({
                text: `plugin: ${plugin.name}${plugin.version ? `@${plugin.version}` : ''} [llms: ${plugin.llms.join(', ')}]`
            }))
        });
    }

    if (llmPacket.length > 0) {
        items.push({
            text: 'research packet',
            children: llmPacket.map((plugin) => ({
                text: `plugin: ${plugin.display_name} [${plugin.host}${plugin.needs_curation ? '; origin missing' : '; origin saved'}]`
            }))
        });
    }

    for (const host of hosts) {
        const children = [
            { text: `installed: ${host.plugins.length}` }
        ];
        if (host.plugins.length > 0) {
            children.push({
                text: 'plugin entries',
                children: host.plugins.map((plugin) => formatAnalyzePluginEntry(plugin, host.llm, annotations, options))
            });
        }
        items.push({
            text: `host: ${host.llm}`,
            children
        });
    }

    return items;
}

function formatAnalyzePluginEntry(plugin, llm, annotations, options) {
    const name = plugin.displayName || plugin.name;
    const item = {
        text: `plugin: ${name}${formatInventoryAnnotation(annotations, `plugins.plugin:${name}`, llm, name, options)}`,
        children: []
    };

    if (!(options && options.explain)) {
        return item;
    }

    const details = [];
    if (plugin.sourceType) {
        let sourceLine = `source: ${plugin.sourceType}`;
        if (plugin.registry) {
            sourceLine += ` (${plugin.registry})`;
        }
        details.push({ text: sourceLine });
    }
    if (plugin.version) {
        details.push({ text: `version: ${plugin.version}` });
    }
    if (plugin.url) {
        details.push({ text: `url: ${plugin.url}` });
    }
    if (plugin.evidence) {
        details.push({ text: `evidence: ${plugin.evidence}` });
    }
    if (plugin.curatedOrigin) {
        details.push({ text: `saved source: ${plugin.curatedOrigin.sourceType || 'unknown'}` });
        if (plugin.curatedOrigin.repo) {
            details.push({ text: `repo: ${plugin.curatedOrigin.repo}` });
        }
        if (plugin.curatedOrigin.url) {
            details.push({ text: `origin url: ${plugin.curatedOrigin.url}` });
        }
        if (plugin.latestVersion) {
            details.push({ text: `latest version: ${plugin.latestVersion}` });
        }
        if (plugin.updateAvailable && plugin.version && plugin.latestVersion) {
            details.push({ text: `update available: yes (installed ${plugin.version} < latest ${plugin.latestVersion})` });
        }
        if (plugin.curatedOrigin.confidence) {
            details.push({ text: `origin confidence: ${plugin.curatedOrigin.confidence}` });
        }
        if (plugin.curatedOrigin.notes) {
            details.push({ text: `origin notes: ${plugin.curatedOrigin.notes}` });
        }
    }
    item.children = details;
    return item;
}

function formatCurateReport(result) {
    const label = result && result.target === 'assets' ? 'asset origins' : 'plugin origins';
    return `${ICONS.completed} ${label} imported target=${result.target}  updated=${result.updated}  file=${result.file}\n`;
}

function formatRememberReport(result) {
    const lines = [];
    lines.push(`${ICONS.completed} remembered scope=${result.scope}  target=${result.target}  changed=${result.changed ? 'yes' : 'no'}  exports=${result.exports.length}`);
    appendTreeItems(lines, [
        { text: `root: ${result.outputRoot}` },
        { text: `source: ${result.source}` },
        { text: `section: ${result.section}` },
        { text: `title: ${result.title}` }
    ]);

    if (result.routes && result.routes.length > 0) {
        lines.push('');
        lines.push('exports');
        appendTreeItems(lines, result.routes.map((entry) => ({
            text: `${entry.from.join(' + ')} -> ${entry.to}`
        })));
    }

    if (result.backupTs) {
        lines.push('');
        lines.push(`backup: ${result.backupTs}`);
    }

    return `${lines.join('\n')}\n`;
}

function appendAnalyzeBucket(lines, title, subtitle, entries, options) {
    if (!entries || entries.length === 0) {
        return;
    }

    lines.push('');
    lines.push(`${title} (${subtitle})`);
    appendTreeItems(lines, (entries || []).map((entry) => ({
        text: formatAnalyzeSummaryLine(entry),
        children: options && options.explain
            ? formatAnalyzeExplainLines(entry).map((detail) => ({ text: detail }))
            : []
    })));
}

function shouldShowAnalyzeBuckets(result, options) {
    if (options && options.verbose) {
        return true;
    }
    const hasInventory = Boolean(
        (result && result.inventory && result.inventory.documents && result.inventory.documents.length > 0)
        || (result && result.inventory && result.inventory.settings && result.inventory.settings.length > 0)
        || (result && result.inventory && result.inventory.skills && result.inventory.skills.length > 0)
        || (result && result.inventory && result.inventory.plugins
            && (((result.inventory.plugins.desired || []).length > 0) || ((result.inventory.plugins.hosts || []).length > 0)))
    );
    if (!hasInventory) {
        const total = (result.summary.common || 0)
            + (result.summary.similar || 0)
            + (result.summary.conflicts || 0)
            + (result.summary.host_only || 0)
            + (result.summary.unknown || 0);
        return total > 0;
    }
    return false;
}

function formatAnalyzeSummaryLine(entry) {
    const label = getAnalyzeLabel(entry).padEnd(28, ' ');
    const llms = uniqueLlms(entry).join('  ');
    if (entry.bucket === 'similar' && typeof entry.score === 'number') {
        return `${label} (${llms}, ${Math.round(entry.score * 100)}%)`;
    }
    if (entry.bucket === 'unknown') {
        return `${label} (${llms}, ${localizeUnknownReason(entry.reason)})`;
    }
    return `${label} (${llms})`;
}

function formatAnalyzeExplainLines(entry) {
    const lines = [];
    if (entry.key) {
        lines.push(`id: ${entry.key}`);
    }
    if (entry.sources && entry.sources.length > 0) {
        lines.push(`present: ${uniqueLlms(entry).join(', ')}`);
        lines.push(`shared: ${entry.bucket === 'common' ? 'yes' : 'no'}`);
    }
    if (entry.reason && entry.bucket !== 'unknown') {
        lines.push(`reason: ${entry.reason}`);
    }
    if (typeof entry.headingScore === 'number') {
        lines.push(`heading similarity: ${Math.round(entry.headingScore * 100)}%`);
    }
    if (typeof entry.bodyScore === 'number') {
        lines.push(`body similarity: ${Math.round(entry.bodyScore * 100)}%`);
    }
    if (entry.sources && entry.sources.length > 0) {
        lines.push(`files: ${entry.sources.map((source) => `${source.llm}:${source.path || source.file}`).join(', ')}`);
    }
    return lines;
}

function getAnalyzeLabel(entry) {
    const value = entry.key || '';
    const index = value.lastIndexOf(':');
    if (index !== -1) {
        return value.slice(index + 1);
    }
    const dotIndex = value.lastIndexOf('.');
    if (dotIndex !== -1) {
        return value.slice(dotIndex + 1);
    }
    return value;
}

function uniqueLlms(entry) {
    return Array.from(new Set((entry.sources || []).map((source) => source.llm)));
}

function localizeUnknownReason(reason) {
    if (String(reason || '').includes('headingless content')) {
        return 'headingless content';
    }
    return reason || 'unclassified';
}

function buildPromptAnnotations(result) {
    return buildCategoryAnnotations(result, 'prompts');
}

function buildCategoryAnnotations(result, category) {
    const map = new Map();
    for (const bucket of ['common', 'similar', 'conflicts', 'host_only', 'unknown']) {
        for (const entry of result && result[bucket] ? result[bucket] : []) {
            if (entry.category !== category || !Array.isArray(entry.sources)) {
                continue;
            }
            for (const source of entry.sources) {
                const values = [];
                const primary = source.path || source.file;
                values.push(primary);
                if (category === 'skills' && source.file) {
                    const parts = String(source.file).replace(/\\/g, '/').split('/');
                    const last = parts[parts.length - 1];
                    values.push(last);
                    values.push(last.replace(/\.md$/u, ''));
                }
                if (category === 'plugins' && source.file) {
                    values.push(String(source.file));
                }
                for (const value of values) {
                    const key = `${source.llm}:${value}`;
                    if (!map.has(key)) {
                        map.set(key, []);
                    }
                    map.get(key).push(entry);
                }
            }
        }
    }
    return map;
}

function formatPromptSectionSuffix(entry, section, annotations, options) {
    const sectionKey = `${entry.llm}:${entry.file}#${section.heading || '(untitled)'}`;
    const matches = annotations.get(sectionKey) || [];
    if (matches.length === 0) {
        return '';
    }

    const finding = matches[0];
    if (!(options && options.explain)) {
        return '';
    }

    const otherSources = (finding.sources || []).filter((source) => source.llm !== entry.llm);
    const peerLlms = Array.from(new Set(otherSources.map((source) => source.llm)));
    const peerLabel = peerLlms.length === 0 ? 'other hosts' : peerLlms.join(', ');

    if (finding.bucket === 'common') {
        return ` [shared; also present in ${peerLabel}]`;
    }
    if (finding.bucket === 'similar') {
        const parts = [`similar section also exists in ${peerLabel}`];
        if (typeof finding.bodyScore === 'number') {
            parts.push(`body ${Math.round(finding.bodyScore * 100)}%`);
        }
        if (typeof finding.headingScore === 'number' && finding.headingScore < 1) {
            parts.push(`heading ${Math.round(finding.headingScore * 100)}%`);
        }
        parts.push('kept separate');
        return ` [${parts.join(', ')}]`;
    }
    if (finding.bucket === 'conflicts') {
        const parts = [`matching section also exists in ${peerLabel}`];
        if (typeof finding.bodyScore === 'number') {
            parts.push(`body ${Math.round(finding.bodyScore * 100)}%`);
        }
        if (typeof finding.headingScore === 'number' && finding.headingScore < 1) {
            parts.push(`heading ${Math.round(finding.headingScore * 100)}%`);
        }
        parts.push('classified as conflict');
        return ` [${parts.join(', ')}]`;
    }
    if (finding.bucket === 'host_only' || finding.bucket === 'hostOnly') {
        return '';
    }
    return ` [${localizeUnknownReason(finding.reason)}]`;
}

function formatInventoryAnnotation(annotations, entryKey, llm, name, options) {
    if (!(options && options.explain)) {
        return '';
    }

    const matches = annotations.get(`${llm}:${name}`) || [];
    const finding = matches.find((entry) => entry.key === entryKey) || matches[0];
    if (!finding) {
        return '';
    }

    const otherSources = (finding.sources || []).filter((source) => source.llm !== llm);
    const peerLlms = Array.from(new Set(otherSources.map((source) => source.llm)));
    const peerLabel = peerLlms.length === 0 ? 'other hosts' : peerLlms.join(', ');

    if (finding.bucket === 'common') {
        return ` [shared; also present in ${peerLabel}]`;
    }
    if (finding.bucket === 'similar') {
        const parts = [`similar entry also exists in ${peerLabel}`];
        if (typeof finding.score === 'number') {
            parts.push(`${Math.round(finding.score * 100)}%`);
        }
        parts.push('kept separate');
        return ` [${parts.join(', ')}]`;
    }
    if (finding.bucket === 'conflicts') {
        const parts = [`matching entry also exists in ${peerLabel}`];
        if (typeof finding.score === 'number') {
            parts.push(`${Math.round(finding.score * 100)}%`);
        }
        parts.push('classified as conflict');
        return ` [${parts.join(', ')}]`;
    }
    return '';
}

function appendSyncDryRunPlan(lines, details, options) {
    const imports = details && details.imports;
    appendInstructionImportPlan(lines, imports, options);
    appendSkillImportPlan(lines, imports, options);
    const plannedAdoptions = new Set((imports || [])
        .filter((entry) => entry.action === 'adopt-plan')
        .map((entry) => `${entry.from}=>${entry.to}`));
    const legacyImports = formatImportDetails((imports || []).filter((entry) => {
        if (entry.action === 'adopt-plan') {
            return false;
        }
        if (entry.action === 'adopt' && plannedAdoptions.has(`${entry.from}=>${entry.to}`)) {
            return false;
        }
        return true;
    }), options);
    if (legacyImports.length > 0) {
        appendSection(lines, 'imports', legacyImports);
    }
    appendSection(lines, 'exports', formatExportDetails(details && details.exports, options));
    appendSection(lines, 'drift', formatDriftDetails(details && details.drift));
    appendSection(lines, 'conflicts', formatConflictDetails(details && details.conflicts));
}

function appendInstructionImportPlan(lines, imports) {
    const grouped = new Map();
    for (const plan of (imports || []).filter((entry) => entry.action === 'adopt-plan')) {
        if (!grouped.has(plan.to)) {
            grouped.set(plan.to, []);
        }
        grouped.get(plan.to).push(plan);
    }

    for (const [target, plans] of grouped.entries()) {
        lines.push('');
        lines.push(target);
        appendTreeItems(lines, plans.map((plan) => ({
            text: `from ${plan.from}`,
            children: buildSectionTreeItems(plan.sections, { dropLeadingLevelOne: true })
        })));
    }
}

function appendSkillImportPlan(lines, imports) {
    const grouped = new Map();
    for (const entry of (imports || []).filter((item) => item.action === 'bucket')) {
        const bucketTarget = entry.type === 'skill'
            ? `.harness/skills/${entry.bucket}/`
            : `.harness/agents/${entry.bucket}/`;
        const sourceRoot = getBucketSourceRoot(entry.from);
        const key = `${entry.type}:${sourceRoot}:${bucketTarget}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                type: entry.type,
                from: sourceRoot,
                to: bucketTarget,
                reason: entry.reason,
                names: []
            });
        }
        grouped.get(key).names.push(entry.name);
    }

    for (const group of grouped.values()) {
        lines.push('');
        const kindLabel = group.type === 'skill' ? 'skills' : 'agents';
        lines.push(`${group.from}  ${group.to} (${group.names.length} ${kindLabel}, ${group.reason})`);
        appendTreeItems(lines, group.names.sort().map((name) => ({ text: name })));
    }
}

function getBucketSourceRoot(relativePath) {
    const normalized = String(relativePath || '').replace(/\\/g, '/');
    const parts = normalized.split('/');
    if (parts.length < 3) {
        return normalized;
    }
    return `${parts.slice(0, parts.length - 1).join('/')}/`;
}

function buildSectionTreeItems(sections, options) {
    if (!sections || sections.length === 0) {
        return [];
    }

    const levels = sections.map((section) => Number.isFinite(section.level) ? section.level : 0);
    const baseLevel = Math.min(...levels);
    const roots = [];
    const stack = [];

    for (const section of sections) {
        const rawLevel = Number.isFinite(section.level) ? section.level : baseLevel;
        const normalizedLevel = Math.max(0, rawLevel - baseLevel);
        const level = Math.min(normalizedLevel, stack.length);
        const heading = section.heading || '(untitled)';
        const suffix = section.nearMatch ? formatNearMatchSuffix(section.nearMatch) : '';
        const item = { text: `${heading}${suffix}`, children: [] };

        while (stack.length > level) {
            stack.pop();
        }

        if (stack.length === 0) {
            roots.push(item);
        } else {
            stack[stack.length - 1].children.push(item);
        }
        stack.push(item);
    }

    if (options && options.dropLeadingLevelOne) {
        return collapseLeadingLevelOne(roots);
    }

    return roots;
}

function collapseLeadingLevelOne(items) {
    if (!items || items.length !== 1) {
        return items || [];
    }

    const [only] = items;
    if (!only.children || only.children.length === 0) {
        return items;
    }
    return only.children;
}

function buildDocumentSectionTreeItems(sections, entry, annotations, options) {
    const roots = [];
    const stack = [];

    for (const section of sections || []) {
        const level = Number.isFinite(section.level) ? section.level : 1;
        while (stack.length >= level) {
            stack.pop();
        }

        const item = {
            text: `section: ${section.heading || '(untitled)'}${formatPromptSectionSuffix(entry, section, annotations, options)}`,
            children: []
        };

        if (stack.length === 0) {
            roots.push(item);
        } else {
            stack[stack.length - 1].children.push(item);
        }
        stack.push(item);
    }

    return roots;
}

function formatNearMatchSuffix(nearMatch) {
    const llmLabel = nearMatch.otherLlms.length === 1
        ? `with ${nearMatch.otherLlms[0]}`
        : `with ${nearMatch.otherLlms.join(', ')}`;
    const details = [`${llmLabel} near match ${Math.round(nearMatch.similarity * 100)}%`];
    if (typeof nearMatch.headingSimilarity === 'number' && nearMatch.matchedBy === 'fuzzy-heading') {
        details.push(`heading ${Math.round(nearMatch.headingSimilarity * 100)}%`);
    }
    if (nearMatch.otherHeading) {
        details.push(`other heading "${nearMatch.otherHeading}"`);
    }
    details.push('kept LLM-specific');
    return ` (${details.join(', ')})`;
}

function appendTreeItems(lines, items, prefix = '') {
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const isLast = index === items.length - 1;
        const branch = isLast ? '└─ ' : '├─ ';
        const childPrefix = `${prefix}${isLast ? '   ' : '│  '}`;

        lines.push(`${prefix}${branch}${item.text}`);
        if (item.children && item.children.length > 0) {
            appendTreeItems(lines, item.children, childPrefix);
        }
    }
}
