#!/usr/bin/env node

const path = require('path');
const { listBackups, restoreBackup } = require('./backup');
const { applyOutputs } = require('./apply');
const { diffOutputs } = require('./diff');
const { discoverState, persistDiscovery } = require('./discover');
const { runDoctor } = require('./doctor');
const { generateOutputs } = require('./generate');
const { createMigrationProposal } = require('./migrate');
const { loadRegistry } = require('./registry');

const ROOT = path.resolve(__dirname, '..');

function main() {
    const command = process.argv[2] || 'help';

    switch (command) {
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
    console.log('Commands:');
    console.log('  discover   Scan local Claude/Codex state');
    console.log('  doctor     Report drift, security issues, and gaps');
    console.log('  migrate    Normalize discovered state into the registry');
    console.log('  generate   Generate host-native outputs from the registry');
    console.log('  diff       Show differences between registry and live state');
    console.log('  apply      Apply generated outputs');
    console.log('  restore    Restore files from the latest or specified backup');
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
    const discovery = discoverState(ROOT, {});
    const persisted = persistDiscovery(ROOT, discovery);

    console.log(`Discovered assets: ${discovery.assets.length}`);
    console.log(`Latest: ${persisted.latestPath}`);
    console.log(`Snapshot: ${persisted.timestampPath}`);
}

function runDoctorCommand() {
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

function runMigrate() {
    const discovery = discoverState(ROOT, {});
    const result = createMigrationProposal(ROOT, discovery);

    console.log(`Proposal: ${result.proposalPath}`);
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

if (require.main === module) {
    main();
}
