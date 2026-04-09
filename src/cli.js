#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { applyAccountOutputs, diffAccountOutputs, discoverAccountHarness, doctorAccountHarness, generateAccountOutputs, getAccountHarnessRoot, initAccountHarness } = require('./account');
const { approveMigration } = require('./approve');
const { listBackups, restoreBackup } = require('./backup');
const { applyOutputs } = require('./apply');
const { diffOutputs } = require('./diff');
const { discoverState, persistDiscovery } = require('./discover');
const { runDoctor } = require('./doctor');
const { exists } = require('./fs-util');
const { generateOutputs } = require('./generate');
const { createMigrationProposal } = require('./migrate');
const { migrateSchema } = require('./migrate-schema');
const { initProjectHarness } = require('./project');
const { collectPreview } = require('./preview');
const { loadRegistry } = require('./registry');
const { addWorkspace, getWorkspaceRegistryPath, hasWorkspaceMarkers, listWorkspaces, removeWorkspace } = require('./workspaces');

const ROOT = resolveRootDir();

function main() {
    const command = process.argv[2] || 'help';

    switch (command) {
        case 'init':
            runInit();
            break;
        case 'account':
            runAccount();
            break;
        case 'workspace':
            runWorkspace();
            break;
        case 'discover':
            runDiscover();
            break;
        case 'doctor':
            runDoctorCommand();
            break;
        case 'preview':
            runPreview();
            break;
        case 'migrate':
            runMigrate();
            break;
        case 'migrate-schema':
            runMigrateSchema();
            break;
        case 'generate':
            runGenerate();
            break;
        case 'diff':
            runDiff();
            break;
        case 'apply':
            runApply();
            break;
        case 'approve':
            runApprove();
            break;
        case 'restore':
            runRestore();
            break;
        case 'help':
        default:
            printHelp();
            break;
    }
}

function printHelp() {
    console.log('soft-harness');
    console.log('');
    console.log(`Root: ${ROOT}`);
    console.log('');
    console.log('Commands:');
    console.log('  init       Initialize a project harness in the current directory');
    console.log('  account    Manage account-wide harness state');
    console.log('  workspace  Manage registered workspaces');
    console.log('  discover   Scan local Claude/Codex state');
    console.log('  doctor     Report drift, security issues, and gaps');
    console.log('  preview    Show a combined preview of registry, discovery, diff, and apply state');
    console.log('  migrate    Normalize discovered state into the registry');
    console.log('  migrate-schema Upgrade registry.yaml from v0 to v1');
    console.log('  generate   Generate host-native outputs from the registry');
    console.log('  diff       Show differences between registry and live state');
    console.log('  apply      Apply generated outputs');
    console.log('  approve    Approve grouped migration proposals into registry.d');
    console.log('  restore    Restore files from the latest or specified backup');
    console.log('');
    console.log('Flags:');
    console.log('  discover --scope project|account');
    console.log('  preview [--verbose]');
    console.log('  apply --dry-run --yes --force --backup');
    console.log('  migrate-schema --apply [--force]');
}

function resolveRootDir() {
    const rootFlagIndex = process.argv.indexOf('--root');
    if (rootFlagIndex >= 0 && process.argv[rootFlagIndex + 1]) {
        return path.resolve(process.argv[rootFlagIndex + 1]);
    }

    return process.cwd();
}

function runGenerate() {
    const loaded = loadRegistry(ROOT);
    const guideCount = Object.values(loaded.registry.guides).reduce((sum, items) => sum + items.length, 0);

    console.log(`Registry: ${loaded.registryPath}`);
    console.log(`Imports: ${loaded.importPaths.length}`);
    console.log(`Capabilities: ${loaded.registry.capabilities.length}`);
    console.log(`Guides: ${guideCount}`);
    console.log(`Outputs: ${(loaded.registry.outputs || []).length}`);

    if (loaded.issues.length > 0) {
        console.log(`Issues: ${loaded.issues.length}`);
        for (const issue of loaded.issues) {
            console.log(`- [${issue.code}] ${issue.message}`);
        }
        process.exitCode = 1;
        return;
    }

    console.log('Issues: 0');
    const generated = generateOutputs(ROOT, loaded);
    for (const item of generated) {
        console.log(`Generated: ${item.applyPath}`);
    }
}

function printNotImplemented(command) {
    console.log(`Command not implemented yet: ${command}`);
    console.log(`Repository root: ${ROOT}`);
}

function runDiscover() {
    if (hasFlag('--all')) {
        runDiscoverAll();
        return;
    }

    const scope = getFlagValue('--scope');
    const discovery = discoverState(ROOT, { scope });

    console.log(`Discovered assets: ${discovery.assets.length}`);
    console.log(`Scope: ${discovery.scope}`);
    console.log(`Tmp: ${discovery.tmpPath}`);
}

function runDoctorCommand() {
    if (hasFlag('--all')) {
        runDoctorAll();
        return;
    }

    const loaded = loadRegistry(ROOT);
    const discovery = discoverState(ROOT, { scope: 'project' });
    const findings = runDoctor(ROOT, loaded, discovery);

    if (findings.length === 0) {
        console.log('Doctor: no issues found');
        return;
    }

    const grouped = groupFindings(findings);
    for (const item of grouped) {
        console.log(`[${item.level}] [${item.code}] ${item.count} finding(s)`);
        for (const sample of item.samples) {
            console.log(`  - ${sample}`);
        }
    }

    if (findings.some((finding) => finding.level === 'error')) {
        process.exitCode = 1;
    }
}

function runPreview() {
    const loaded = loadRegistry(ROOT);
    const preview = collectPreview(ROOT, loaded);
    const verbose = hasFlag('--verbose');

    console.log(`Root: ${preview.rootDir}`);
    console.log(`Registry: ${preview.registry.path}`);
    console.log(`Imports: ${preview.registry.imports}`);
    console.log(`Capabilities: ${preview.registry.capabilities}`);
    console.log(`Guides: ${preview.registry.guides}`);
    console.log(`Outputs: ${preview.registry.outputs}`);
    console.log(`Registry issues: ${preview.registry.issues}`);
    console.log(`Discovery scope: ${preview.discovery.scope}`);
    console.log(`Discovery assets: ${preview.discovery.assets}`);
    console.log(`Discovery tmp persisted: ${preview.discovery.persisted ? 'yes' : 'no'}`);
    console.log(`Pending proposals: ${preview.proposals.pending}`);
    console.log(`Proposal guides: ${preview.proposals.copiedGuides}`);
    console.log(`Proposal capabilities: ${preview.proposals.capabilityProposals}`);
    console.log(`Doctor errors: ${preview.doctor.errors}`);
    console.log(`Doctor warnings: ${preview.doctor.warnings}`);
    console.log(`Diff total: ${preview.diff.total}`);
    printStatusSummary('Diff', preview.diff.counts);
    console.log(`Apply preview total: ${preview.apply.total}`);
    printStatusSummary('Apply', preview.apply.counts);

    for (const group of preview.doctor.groups.slice(0, 5)) {
        console.log(`Doctor group: [${group.level}] [${group.code}] ${group.count}`);
    }

    if (verbose) {
        printPreviewDetails(preview);
    }

    if (preview.doctor.errors > 0 || preview.registry.issues > 0) {
        process.exitCode = 1;
    }
}

function runWorkspace() {
    const subcommand = process.argv[3] || 'list';

    switch (subcommand) {
        case 'add':
            runWorkspaceAdd();
            break;
        case 'remove':
            runWorkspaceRemove();
            break;
        case 'list':
        default:
            runWorkspaceList();
            break;
    }
}

function runInit() {
    const result = initProjectHarness(ROOT);
    console.log(`Harness root: ${result.harnessRoot}`);
    console.log(`Registry: ${result.registryPath}`);
}

function runAccount() {
    const subcommand = process.argv[3] || 'doctor';

    switch (subcommand) {
        case 'init':
            runAccountInit();
            break;
        case 'discover':
            runAccountDiscover();
            break;
        case 'doctor':
            runAccountDoctor();
            break;
        case 'generate':
            runAccountGenerate();
            break;
        case 'apply':
            runAccountApply();
            break;
        case 'diff':
            runAccountDiff();
            break;
        default:
            console.log(`Unknown account command: ${subcommand}`);
            process.exitCode = 1;
            break;
    }
}

function runWorkspaceAdd() {
    const workspacePath = process.argv[4] ? path.resolve(process.argv[4]) : ROOT;
    const result = addWorkspace(workspacePath);

    if (!hasWorkspaceMarkers(workspacePath)) {
        console.log(`Warning: ${workspacePath} does not contain .git or harness/registry.yaml`);
    }

    console.log(`Registry: ${result.registryPath}`);
    console.log(`Workspace: ${result.workspace.path}`);
    console.log(`Id: ${result.workspace.id}`);
    console.log(`Status: ${result.action}`);
}

function runWorkspaceRemove() {
    const workspacePath = process.argv[4] ? path.resolve(process.argv[4]) : ROOT;
    const result = removeWorkspace(workspacePath);

    console.log(`Registry: ${result.registryPath}`);
    console.log(`Workspace: ${workspacePath}`);
    console.log(`Status: ${result.action}`);

    if (result.action === 'missing') {
        process.exitCode = 1;
    }
}

function runWorkspaceList() {
    const loaded = listWorkspaces();
    console.log(`Registry: ${loaded.registryPath}`);

    if (loaded.registry.workspaces.length === 0) {
        console.log('Workspaces: 0');
        return;
    }

    console.log(`Workspaces: ${loaded.registry.workspaces.length}`);
    for (const workspace of loaded.registry.workspaces) {
        console.log(`- ${workspace.id} ${workspace.path}`);
    }
}

function runDiscoverAll() {
    const loaded = listWorkspaces();
    console.log(`Registry: ${loaded.registryPath}`);

    if (loaded.registry.workspaces.length === 0) {
        console.log('Workspaces: 0');
        return;
    }

    for (const workspace of loaded.registry.workspaces) {
        const discovery = discoverState(workspace.path, { scope: 'project' });
        console.log(`[ok] ${workspace.id} assets=${discovery.assets.length}`);
        console.log(`  tmp: ${discovery.tmpPath}`);
    }
}

function runDoctorAll() {
    const loadedWorkspaces = listWorkspaces();
    console.log(`Registry: ${loadedWorkspaces.registryPath}`);

    const accountHarnessRoot = getAccountHarnessRoot();
    if (exists(path.join(accountHarnessRoot, 'registry.yaml'))) {
        const accountResult = doctorAccountHarness();
        const errorCount = accountResult.findings.filter((finding) => finding.level === 'error').length;
        const warningCount = accountResult.findings.filter((finding) => finding.level === 'warning').length;
        console.log(`[${errorCount > 0 ? 'error' : 'ok'}] account errors=${errorCount} warnings=${warningCount}`);
        for (const finding of accountResult.findings.slice(0, 5)) {
            console.log(`  - [${finding.level}] [${finding.code}] ${finding.message}`);
        }
        if (errorCount > 0) {
            process.exitCode = 1;
        }
    } else {
        console.log(`[skip] account missing ${path.join(accountHarnessRoot, 'registry.yaml')}`);
    }

    if (loadedWorkspaces.registry.workspaces.length === 0) {
        console.log('Workspaces: 0');
        return;
    }

    let hasErrors = false;
    for (const workspace of loadedWorkspaces.registry.workspaces) {
        const registryPath = path.join(workspace.path, 'harness', 'registry.yaml');
        if (!exists(registryPath)) {
            console.log(`[skip] ${workspace.id} missing ${registryPath}`);
            continue;
        }

        const loaded = loadRegistry(workspace.path);
        const discovery = discoverState(workspace.path, { scope: 'project' });
        const findings = runDoctor(workspace.path, loaded, discovery);
        const errorCount = findings.filter((finding) => finding.level === 'error').length;
        const warningCount = findings.filter((finding) => finding.level === 'warning').length;
        console.log(`[${errorCount > 0 ? 'error' : 'ok'}] ${workspace.id} errors=${errorCount} warnings=${warningCount}`);

        if (findings.length > 0) {
            for (const finding of findings.slice(0, 5)) {
                console.log(`  - [${finding.level}] [${finding.code}] ${finding.message}`);
            }
        }

        if (errorCount > 0) {
            hasErrors = true;
        }
    }

    if (hasErrors) {
        process.exitCode = 1;
    }
}

function runAccountInit() {
    const result = initAccountHarness();
    console.log(`Harness root: ${result.harnessRoot}`);
    console.log(`Registry: ${result.registryPath}`);
}

function runAccountDiscover() {
    const discovery = discoverState(ROOT, { scope: 'account' });
    console.log(`Discovered assets: ${discovery.assets.length}`);
    console.log(`Scope: ${discovery.scope}`);
    console.log(`Tmp: ${discovery.tmpPath}`);
}

function runAccountDoctor() {
    const result = doctorAccountHarness();
    console.log(`Harness root: ${result.harnessRoot}`);

    if (result.findings.length === 0) {
        console.log('Doctor: no issues found');
        return;
    }

    const grouped = groupFindings(result.findings);
    for (const item of grouped) {
        console.log(`[${item.level}] [${item.code}] ${item.count} finding(s)`);
        for (const sample of item.samples) {
            console.log(`  - ${sample}`);
        }
    }

    if (result.findings.some((finding) => finding.level === 'error')) {
        process.exitCode = 1;
    }
}

function runAccountGenerate() {
    const result = generateAccountOutputs();
    console.log(`Harness root: ${result.harnessRoot}`);
    for (const item of result.generated) {
        console.log(`Generated: ${item.applyPath}`);
    }
}

function runAccountApply() {
    const result = applyAccountOutputs();
    console.log(`Harness root: ${result.harnessRoot}`);
    for (const item of result.applied) {
        console.log(`Applied (${item.status}): ${item.applyPath}`);
    }
}

function runAccountDiff() {
    const result = diffAccountOutputs();
    console.log(`Harness root: ${result.harnessRoot}`);
    if (result.diffs.length === 0) {
        console.log('Diff: no outputs defined');
        return;
    }

    for (const diff of result.diffs) {
        console.log(`[${diff.status}] ${diff.id}`);
        console.log(`  apply: ${diff.applyPath}`);
    }
}

function runMigrate() {
    const scope = getFlagValue('--scope') || 'project';
    const loaded = loadRegistry(ROOT);
    const result = createMigrationProposal(ROOT, { scope }, loaded);

    console.log(`Proposal directory: ${result.proposalDir}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`Scope: ${result.scope}`);
    console.log(`Proposal files: ${result.proposalFiles.length}`);
    console.log(`Copied guides: ${result.copiedGuideCount}`);
    console.log(`Capability proposals: ${result.capabilityCount}`);
    console.log(`Backup: ${result.backup.manifestPath}`);
    console.log(`Backed up files: ${result.backup.entryCount}`);
}

function runMigrateSchema() {
    const apply = hasFlag('--apply');
    const force = hasFlag('--force');
    const result = migrateSchema(ROOT, {
        dryRun: !apply,
        apply,
        force
    });

    console.log('Changes:');
    for (const change of result.changes) {
        console.log(`  - ${change}`);
    }

    if (result.warnings.length > 0) {
        console.log('Warnings:');
        for (const warning of result.warnings) {
            console.log(`  - ${warning}`);
        }
    }

    if (!apply) {
        console.log('Dry run only. Pass --apply to write changes.');
    }
}

function runDiff() {
    const loaded = loadRegistry(ROOT);
    const diffs = diffOutputs(ROOT, loaded);

    if (diffs.length === 0) {
        console.log('Diff: no outputs defined');
        return;
    }

    for (const diff of diffs) {
        console.log(`[${diff.status}] ${diff.id}`);
        console.log(`  apply: ${diff.applyPath}`);
    }
}

function runApply() {
    const loaded = loadRegistry(ROOT);
    if (loaded.issues.length > 0) {
        for (const issue of loaded.issues) {
            console.log(`[${issue.level}] [${issue.code}] ${issue.message}`);
        }
        process.exitCode = 1;
        return;
    }

    const dryRun = hasFlag('--dry-run');
    const yes = hasFlag('--yes');
    const force = hasFlag('--force');
    const backup = hasFlag('--backup');
    const preview = applyOutputs(ROOT, loaded, {
        dryRun: true,
        force
    });

    for (const item of preview) {
        const unmanaged = item.unmanaged ? ' unmanaged' : '';
        console.log(`[${item.status}] ${item.id}${unmanaged}`);
        console.log(`  apply: ${item.applyPath}`);
    }

    if (dryRun) {
        return;
    }

    let proceed = yes || force;
    if (!proceed) {
        proceed = promptToProceed();
    }

    if (!proceed) {
        console.log('Apply cancelled.');
        return;
    }

    const applied = applyOutputs(ROOT, loaded, {
        yes: true,
        force,
        backup,
        reason: backup ? 'apply --backup' : 'apply'
    });
    for (const item of applied) {
        console.log(`Applied (${item.status}): ${item.applyPath}`);
    }
}

function runRestore() {
    const explicitBackupId = process.argv[3];
    const backups = listBackups(ROOT);
    if (backups.length === 0) {
        console.log('No backups found');
        process.exitCode = 1;
        return;
    }

    const backupId = explicitBackupId || backups[backups.length - 1];
    const result = restoreBackup(ROOT, backupId);
    console.log(`Restored backup: ${result.backupId}`);
    console.log(`Manifest: ${result.manifestPath}`);
    console.log(`Files restored: ${result.restoredCount}`);
}

function runApprove() {
    const proposalDir = process.argv[3] ? path.resolve(process.argv[3]) : null;
    const result = approveMigration(ROOT, proposalDir);
    console.log(`Approved from: ${result.proposalDir}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`Approved files: ${result.approvedFiles.length}`);
    for (const file of result.approvedFiles) {
        console.log(`  - ${file}`);
    }
}

function groupFindings(findings) {
    const grouped = new Map();

    for (const finding of findings) {
        const key = `${finding.level}:${finding.code}`;
        if (!grouped.has(key)) {
            grouped.set(key, {
                level: finding.level,
                code: finding.code,
                count: 0,
                samples: []
            });
        }

        const entry = grouped.get(key);
        entry.count += 1;
        if (entry.samples.length < 5) {
            entry.samples.push(finding.message);
        }
    }

    return Array.from(grouped.values());
}

function printStatusSummary(label, counts) {
    const entries = Object.entries(counts);
    if (entries.length === 0) {
        console.log(`${label} statuses: none`);
        return;
    }

    console.log(`${label} statuses: ${entries.map(([status, count]) => `${status}=${count}`).join(', ')}`);
}

function printPreviewDetails(preview) {
    console.log('Discovery assets:');
    if (preview.details.discoveryAssets.length === 0) {
        console.log('  - none');
    } else {
        for (const asset of preview.details.discoveryAssets) {
            console.log(`  - [${asset.classification}] [${asset.scope}] [${asset.target}] [${asset.type}] ${asset.path}`);
        }
    }

    console.log('Proposal files:');
    if (preview.details.proposalFiles.length === 0) {
        console.log('  - none');
    } else {
        for (const filePath of preview.details.proposalFiles) {
            console.log(`  - ${filePath}`);
        }
    }

    console.log('Doctor findings:');
    if (preview.details.doctorFindings.length === 0) {
        console.log('  - none');
    } else {
        for (const finding of preview.details.doctorFindings) {
            console.log(`  - [${finding.level}] [${finding.code}] ${finding.message}`);
        }
    }

    console.log('Diff items:');
    if (preview.details.diffs.length === 0) {
        console.log('  - none');
    } else {
        for (const diff of preview.details.diffs) {
            console.log(`  - [${diff.status}] ${diff.id} ${diff.applyPath}`);
        }
    }

    console.log('Apply preview items:');
    if (preview.details.applyPreview.length === 0) {
        console.log('  - none');
    } else {
        for (const item of preview.details.applyPreview) {
            const unmanaged = item.unmanaged ? ' unmanaged' : '';
            console.log(`  - [${item.status}] ${item.id}${unmanaged} ${item.applyPath}`);
        }
    }
}

function hasFlag(flag) {
    return process.argv.includes(flag);
}

function getFlagValue(flag) {
    const inline = process.argv.find((arg) => arg.startsWith(`${flag}=`));
    if (inline) {
        return inline.slice(flag.length + 1);
    }

    const index = process.argv.indexOf(flag);
    if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
        return process.argv[index + 1];
    }

    return undefined;
}

function promptToProceed() {
    const prompt = 'Proceed with apply? [y/N] ';
    fs.writeSync(process.stdout.fd, prompt);
    const buffer = Buffer.alloc(1024);
    const bytesRead = fs.readSync(process.stdin.fd, buffer, 0, buffer.length, null);
    const answer = buffer.toString('utf8', 0, bytesRead).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
}

if (require.main === module) {
    main();
}
