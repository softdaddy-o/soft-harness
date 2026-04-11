#!/usr/bin/env node

const { listBackups } = require('./backup');

const HELP = `soft-harness - single source of truth for LLM harness files

Commands:
  soft-harness sync [options]         Reconcile .harness/ with the project
  soft-harness revert --list          List available backups
  soft-harness revert <timestamp>     Restore files from a backup
  soft-harness help                   Show this message

Sync options:
  --manual-review                     Confirm extraction and conflict decisions
  --dry-run                           Report planned changes and write nothing
  --no-import                         Skip project -> .harness import and pull-back
  --no-export                         Skip .harness -> project export
  --no-run-installs                   Skip plugin install commands
  --no-run-uninstalls                 Skip plugin uninstall commands
`;

function parseSyncArgs(args) {
    const flags = new Set(args);

    return {
        dryRun: flags.has('--dry-run') || flags.has('-n'),
        manualReview: flags.has('--manual-review') || flags.has('-i'),
        noImport: flags.has('--no-import'),
        noExport: flags.has('--no-export'),
        noRunInstalls: flags.has('--no-run-installs'),
        noRunUninstalls: flags.has('--no-run-uninstalls')
    };
}

async function runSync(args, io) {
    const { runSync: runSyncImpl } = require('./sync');
    const result = await runSyncImpl(process.cwd(), parseSyncArgs(args), io);

    if (result.phase === 'dry-run') {
        process.stdout.write(`dry-run: import=${result.plan.import.length} export=${result.plan.export.length} drift=${result.plan.drift.length} conflicts=${result.plan.conflicts.length}\n`);
        if (result.plan.plugins.length > 0) {
            process.stdout.write(`plugins: ${result.plan.plugins.length}\n`);
        }
        return 0;
    }

    process.stdout.write(`sync completed: imported=${result.imported.length} exported=${result.exported.length} pulled_back=${result.pulledBack.length}\n`);
    if (result.backupTs) {
        process.stdout.write(`backup: ${result.backupTs}\n`);
    }
    if (result.pluginActions.length > 0) {
        process.stdout.write(`plugin actions: ${result.pluginActions.length}\n`);
    }
    return 0;
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
    main,
    parseSyncArgs
};
