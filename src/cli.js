#!/usr/bin/env node

const { listBackups } = require('./backup');

const HELP = `soft-harness - single source of truth for LLM harness files

Commands:
  soft-harness sync [options]         Reconcile .harness/ with the project
  soft-harness analyze [options]      Compare prompts, settings, and skills across hosts
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
`;

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
    formatSyncReport,
    main,
    parseAnalyzeArgs,
    parseSyncArgs
};

function formatSyncReport(result, options) {
    const lines = [];
    if (result.phase === 'dry-run') {
        lines.push(`dry-run: import=${result.plan.import.length} export=${result.plan.export.length} drift=${result.plan.drift.length} conflicts=${result.plan.conflicts.length}`);
    } else {
        lines.push(`sync completed: imported=${result.imported.length} exported=${result.exported.length} pulled_back=${result.pulledBack.length}`);
        if (result.backupTs) {
            lines.push(`backup: ${result.backupTs}`);
        }
    }

    appendSection(lines, 'imports', formatImportDetails(result.details && result.details.imports, options));
    appendSection(lines, 'exports', formatExportDetails(result.details && result.details.exports, options));
    appendSection(lines, 'drift', formatDriftDetails(result.details && result.details.drift));
    appendSection(lines, 'conflicts', formatConflictDetails(result.details && result.details.conflicts));

    if (result.pluginActions && result.pluginActions.length > 0) {
        lines.push('plugins:');
        for (const action of result.pluginActions) {
            lines.push(`  - ${action.status}: ${action.name}${action.version ? `@${action.version}` : ''}`);
        }
    }

    return `${lines.join('\n')}\n`;
}

function appendSection(lines, label, entries) {
    if (!entries || entries.length === 0) {
        return;
    }

    lines.push(`${label}:`);
    for (const entry of entries) {
        lines.push(`  - ${entry}`);
    }
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
    lines.push(`analyze: common=${result.summary.common} similar=${result.summary.similar} conflicts=${result.summary.conflicts} host_only=${result.summary.host_only} unknown=${result.summary.unknown}`);

    appendSection(lines, 'common', formatAnalyzeEntries(result.common, options));
    appendSection(lines, 'similar', formatAnalyzeEntries(result.similar, options));
    appendSection(lines, 'conflicts', formatAnalyzeEntries(result.conflicts, options));
    appendSection(lines, 'host_only', formatAnalyzeEntries(result.host_only, options));
    appendSection(lines, 'unknown', formatAnalyzeEntries(result.unknown, options));

    return `${lines.join('\n')}\n`;
}

function formatAnalyzeEntries(entries, options) {
    return (entries || []).map((entry) => {
        const sources = (entry.sources || [])
            .map((source) => `${source.llm}:${source.path || source.file}`)
            .join(', ');
        const detail = [`${entry.category}.${entry.kind} ${entry.key}`];
        if (options && options.verbose && sources) {
            detail.push(`from ${sources}`);
        }
        if (options && options.explain && entry.reason) {
            detail.push(`(${entry.reason})`);
        }
        return detail.join(' ');
    });
}
