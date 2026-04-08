#!/usr/bin/env node

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
const { loadRegistry } = require('./registry');
const { addWorkspace, getWorkspaceRegistryPath, hasWorkspaceMarkers, listWorkspaces, removeWorkspace } = require('./workspaces');

const ROOT = resolveRootDir();

function main() {
    const command = process.argv[2] || 'help';

    switch (command) {
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
        case 'migrate':
            runMigrate();
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
    console.log('  account    Manage account-wide harness state');
    console.log('  workspace  Manage registered workspaces');
    console.log('  discover   Scan local Claude/Codex state');
    console.log('  doctor     Report drift, security issues, and gaps');
    console.log('  migrate    Normalize discovered state into the registry');
    console.log('  generate   Generate host-native outputs from the registry');
    console.log('  diff       Show differences between registry and live state');
    console.log('  apply      Apply generated outputs');
    console.log('  approve    Approve grouped migration proposals into registry.d');
    console.log('  restore    Restore files from the latest or specified backup');
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
        console.log(`Generated: ${item.generatedPath}`);
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

    const discovery = discoverState(ROOT, {});
    const persisted = persistDiscovery(ROOT, discovery);

    console.log(`Discovered assets: ${discovery.assets.length}`);
    console.log(`Latest: ${persisted.latestPath}`);
    console.log(`Snapshot: ${persisted.timestampPath}`);
}

function runDoctorCommand() {
    if (hasFlag('--all')) {
        runDoctorAll();
        return;
    }

    const loaded = loadRegistry(ROOT);
    const discovery = discoverState(ROOT, {});
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
        const discovery = discoverState(workspace.path, {});
        const persisted = persistDiscovery(workspace.path, discovery);
        console.log(`[ok] ${workspace.id} assets=${discovery.assets.length}`);
        console.log(`  latest: ${persisted.latestPath}`);
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
        const discovery = discoverState(workspace.path, {});
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
    const result = discoverAccountHarness();
    console.log(`Harness root: ${result.harnessRoot}`);
    console.log(`Discovered assets: ${result.discovery.assets.length}`);
    console.log(`Latest: ${result.persisted.latestPath}`);
    console.log(`Snapshot: ${result.persisted.timestampPath}`);
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
        console.log(`Generated: ${item.generatedPath}`);
    }
}

function runAccountApply() {
    const result = applyAccountOutputs();
    console.log(`Harness root: ${result.harnessRoot}`);
    for (const item of result.applied) {
        console.log(`Applied (${item.applyMode}): ${item.applyPath}`);
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
        console.log(`  generated: ${diff.generatedPath}`);
        console.log(`  applied:   ${diff.applyPath}`);
    }
}

function runMigrate() {
    const discovery = discoverState(ROOT, {});
    const loaded = loadRegistry(ROOT);
    const result = createMigrationProposal(ROOT, discovery, loaded);

    console.log(`Proposal directory: ${result.proposalDir}`);
    console.log(`Summary: ${result.summaryPath}`);
    console.log(`Proposal files: ${result.proposalFiles.length}`);
    console.log(`Copied guides: ${result.copiedGuideCount}`);
    console.log(`Capability proposals: ${result.capabilityCount}`);
    console.log(`Backup: ${result.backup.manifestPath}`);
    console.log(`Backed up files: ${result.backup.entryCount}`);
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
        console.log(`  generated: ${diff.generatedPath}`);
        console.log(`  applied:   ${diff.applyPath}`);
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

    generateOutputs(ROOT, loaded);
    const applied = applyOutputs(ROOT, loaded);
    for (const item of applied) {
        console.log(`Applied (${item.applyMode}): ${item.applyPath}`);
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

function hasFlag(flag) {
    return process.argv.includes(flag);
}

if (require.main === module) {
    main();
}
