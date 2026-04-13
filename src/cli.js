#!/usr/bin/env node

const { listBackups } = require('./backup');

const HELP = `soft-harness - single source of truth for LLM harness files

Commands:
  soft-harness sync [options]         Reconcile .harness/ with the project
  soft-harness analyze [options]      Compare prompts, settings, and skills across hosts
  soft-harness remember [options]     Record memory into harness truth and regenerate outputs
  soft-harness revert --list          List available backups
  soft-harness revert <timestamp>     Restore files from a backup
  soft-harness help                   Show this message

Sync options:
  --manual-review                     Confirm extraction and conflict decisions
  --dry-run                           Report planned changes and write nothing
  --verbose                           Show file-level sync details
  --explain                           Show routing reasons and merge details
  --yes                               Auto-approve first-sync review prompts
  --no-import                         Skip project -> .harness import and pull-back
  --no-export                         Skip .harness -> project export
  --link-mode=<mode>                  Export skill/agent links using copy, symlink, or junction
  --force-export-untracked-hosts      Allow repo-internal link exports even when target paths are not gitignored
  --no-run-installs                   Skip plugin install commands
  --no-run-uninstalls                 Skip plugin uninstall commands

Analyze options:
  --category=<name>                   Analyze prompts, settings, skills, or all
  --llms=<names>                      Limit analysis to a comma-separated llm list
  --verbose                           Show file-level analysis details
  --explain                           Show classification reasons
  --json                              Emit JSON instead of text

Remember options:
  --scope=<project|account>           Write to the project .harness/ or the account home .harness/
  --llm=<shared|claude|codex|gemini>  Choose the shared or per-LLM destination
  --section=<name>                    Store the entry under this section heading
  --title=<name>                      Entry title to create or update
  --content=<text>                    Entry body content
  --no-export                         Update harness truth without regenerating host outputs
`;

const ICONS = {
    analyze: '📊',
    common: '✅ Common',
    completed: '✅',
    conflicts: '⚠️ Conflicts',
    documents: '📄 Documents',
    hostOnly: '📍 Host Only',
    settings: '⚙️ Settings',
    similar: '🔀 Similar',
    syncPlan: '📦',
    unknown: '❓ Unknown'
};

function parseSyncArgs(args) {
    const flags = new Set(args);
    const linkModeArg = args.find((arg) => arg.startsWith('--link-mode='));
    const linkMode = linkModeArg ? linkModeArg.split('=')[1] : 'copy';
    if (!['copy', 'symlink', 'junction'].includes(linkMode)) {
        throw new Error(`invalid --link-mode: ${linkMode}`);
    }

    return {
        dryRun: flags.has('--dry-run') || flags.has('-n'),
        explain: flags.has('--explain'),
        forceExportUntrackedHosts: flags.has('--force-export-untracked-hosts'),
        linkMode,
        manualReview: flags.has('--manual-review') || flags.has('-i'),
        noImport: flags.has('--no-import'),
        noExport: flags.has('--no-export'),
        noRunInstalls: flags.has('--no-run-installs'),
        noRunUninstalls: flags.has('--no-run-uninstalls'),
        verbose: flags.has('--verbose') || flags.has('--explain'),
        yes: flags.has('--yes')
    };
}

function parseAnalyzeArgs(args) {
    const flags = new Set(args);
    const categoryArg = args.find((arg) => arg.startsWith('--category='));
    const llmsArg = args.find((arg) => arg.startsWith('--llms='));
    const category = categoryArg ? categoryArg.split('=')[1] : 'all';
    if (!['all', 'prompts', 'settings', 'skills'].includes(category)) {
        throw new Error(`invalid --category: ${category}`);
    }

    const llms = llmsArg
        ? llmsArg.split('=')[1].split(',').map((value) => value.trim()).filter(Boolean)
        : [];

    return {
        category,
        explain: flags.has('--explain'),
        json: flags.has('--json'),
        llms,
        verbose: flags.has('--verbose') || flags.has('--explain')
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

    const result = await runSyncImpl(process.cwd(), syncOptions, io);

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
        const result = await runAnalyzeImpl(process.cwd(), analyzeOptions);
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
    formatAnalyzeReport,
    formatRememberReport,
    formatSyncReport,
    main,
    parseAnalyzeArgs,
    parseSyncArgs
};

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
            items.push(`section "${entry.heading || '(untitled)'}" left LLM-specific (near match across ${entry.llms.join(', ')}, similarity=${entry.similarity.toFixed(2)})`);
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
    lines.push(`${ICONS.analyze} common=${result.summary.common}  similar=${result.summary.similar}  conflicts=${result.summary.conflicts}  host_only=${result.summary.host_only}  unknown=${result.summary.unknown}`);

    if (options && options.verbose) {
        appendAnalyzeBucket(lines, ICONS.common, '동일 내용', result.common, options);
    }
    appendAnalyzeBucket(lines, ICONS.similar, '같은 제목, 내용 유사', result.similar, options);
    appendAnalyzeBucket(lines, ICONS.conflicts, '같은 제목, 내용 충돌', result.conflicts, options);
    if (options && options.verbose) {
        appendAnalyzeBucket(lines, ICONS.hostOnly, '한 호스트에만 존재', result.host_only, options);
    }
    appendAnalyzeBucket(lines, ICONS.unknown, '자동 분류 불가', result.unknown, options);

    if (options && options.explain) {
        appendSection(lines, ICONS.documents, formatAnalyzeDocuments(result.inventory && result.inventory.documents));
        appendSection(lines, ICONS.settings, formatAnalyzeSettings(result.inventory && result.inventory.settings));
    }

    return `${lines.join('\n')}\n`;
}

function formatAnalyzeDocuments(entries) {
    return (entries || []).map((entry) => {
        const parts = [`${entry.llm}:${entry.file}`, `[${entry.mode}]`, `headings=${entry.sectionHeadings.length}`];
        if (entry.sourceFiles && entry.sourceFiles.length > 0) {
            parts.push(`sources=${entry.sourceFiles.join(', ')}`);
        }
        if (entry.sectionHeadings && entry.sectionHeadings.length > 0) {
            parts.push(`sections=${entry.sectionHeadings.join(', ')}`);
        }
        if (entry.untitledCount > 0) {
            parts.push(`untitled=${entry.untitledCount}`);
        }
        return parts.join('  ');
    });
}

function formatAnalyzeSettings(entries, options) {
    return (entries || []).map((entry) => {
        const parts = [`${entry.llm}:${entry.file}`, `[${entry.format}/${entry.status}]`, `mcp=${entry.mcpServers.length}`, `keys=${entry.hostOnlyKeys.length}`];
        if (entry.mcpServers.length > 0) {
            parts.push(`servers=${entry.mcpServers.join(', ')}`);
        }
        if (entry.hostOnlyKeys.length > 0) {
            parts.push(`keys=${entry.hostOnlyKeys.join(', ')}`);
        }
        if (entry.error) {
            parts.push(`error=${entry.error}`);
        }
        return parts.join('  ');
    });
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
    if (entry.reason && entry.bucket !== 'unknown') {
        lines.push(`reason: ${entry.reason}`);
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
        return '헤딩 없는 내용';
    }
    return reason || '분류 불가';
}

function appendSyncDryRunPlan(lines, details, options) {
    const imports = details && details.imports;
    appendInstructionImportPlan(lines, imports, options);
    appendSkillImportPlan(lines, imports, options);
    const legacyImports = formatImportDetails((imports || []).filter((entry) => entry.action !== 'adopt-plan'), options);
    if (legacyImports.length > 0) {
        appendSection(lines, 'imports', legacyImports);
    }
    appendSection(lines, 'exports', formatExportDetails(details && details.exports, options));
    appendSection(lines, 'drift', formatDriftDetails(details && details.drift));
    appendSection(lines, 'conflicts', formatConflictDetails(details && details.conflicts));
}

function appendInstructionImportPlan(lines, imports, options) {
    const plans = (imports || []).filter((entry) => entry.action === 'adopt-plan');
    for (const plan of plans) {
        lines.push('');
        lines.push(`${plan.from}  ${plan.to}`);
        appendTreeItems(lines, buildSectionTreeItems(plan.sections));
    }
}

function appendSkillImportPlan(lines, imports, options) {
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
        const reasonLabel = group.reason === 'llm-specific' ? '전부 llm-specific' : group.reason;
        lines.push(`${group.from}  ${group.to} (${group.names.length} ${kindLabel}, ${reasonLabel})`);
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

function buildSectionTreeItems(sections) {
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
        const suffix = section.nearMatch
            ? ` (${section.nearMatch.otherLlms.join(', ')}와 near match ${Math.round(section.nearMatch.similarity * 100)}%, LLM-specific 유지)`
            : '';
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

    return roots;
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
