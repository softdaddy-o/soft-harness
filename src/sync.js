const path = require('node:path');
const { createBackup } = require('./backup');
const { discoverInstructions } = require('./discover');
const { detectAllDrift, detectInstructionDrift } = require('./drift');
const { buildInstructionExports, exportInstructions } = require('./export');
const { exists, formatOffsetDate, readUtf8, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { importInstructions } = require('./import');
const { syncPlugins } = require('./plugins');
const { getProfile } = require('./profiles');
const { pullBackInstructionDrift } = require('./pullback');
const { discoverHarnessAssets, discoverSkillsAndAgents, exportSkillsAndAgents, importSkillsAndAgents, pullBackSkillsAndAgents } = require('./skills');
const { loadState, saveState } = require('./state');

async function runSync(rootDir, options, io) {
    const state = loadState(rootDir);
    const effectiveOptions = {
        ...(options || {}),
        ...(io || {}),
        state
    };
    const firstSync = isFirstSync(state);
    effectiveOptions.firstSync = firstSync;
    effectiveOptions.reviewImports = Boolean(options && options.manualReview)
        || Boolean(options && options.interactive && firstSync && !options.yes);

    const discovered = await discoverInstructions(rootDir, effectiveOptions);
    const backupTargets = collectInitialBackupTargets(rootDir, discovered, state);
    const backup = (options && options.dryRun)
        ? null
        : createBackup(rootDir, backupTargets, { reason: 'sync' });
    ensureHarnessFiles(rootDir, options);

    const plan = {
        import: [],
        export: [],
        drift: [],
        conflicts: [],
        plugins: []
    };
    const imported = [];
    const exported = [];
    const pulledBack = [];
    let pluginActions = [];
    const details = {
        imports: [],
        exports: [],
        drift: [],
        conflicts: []
    };

    if (!options || !options.noImport) {
        const importResult = await importInstructions(rootDir, discovered, effectiveOptions);
        imported.push(...importResult.imported);
        plan.import.push(...importResult.imported);
        details.imports.push(...(importResult.routes || []));

        const skillImportResult = importSkillsAndAgents(rootDir, options);
        imported.push(...skillImportResult.imported);
        plan.import.push(...skillImportResult.imported);
        details.imports.push(...(skillImportResult.routes || []));
    }

    const instructionDrift = detectInstructionDrift(rootDir, { state });
    const conflicts = detectInstructionConflicts(rootDir, state, instructionDrift);
    plan.conflicts.push(...conflicts);
    details.conflicts.push(...conflicts);
    const conflictDecisions = (options && options.dryRun)
        ? new Map()
        : await resolveInstructionConflicts(conflicts, {
            ...options,
            ...(io || {})
        });

    const unresolvedConflicts = conflicts.filter((entry) => !conflictDecisions.has(entry.relativePath));
    if (unresolvedConflicts.length > 0 && (!options || !options.dryRun)) {
        throw new Error(`unresolved instruction conflicts: ${unresolvedConflicts.map((entry) => entry.relativePath).join(', ')}`);
    }

    const remainingInstructionDrift = instructionDrift.filter((entry) => {
        if (!conflicts.some((conflict) => conflict.relativePath === entry.relativePath)) {
            return true;
        }
        return conflictDecisions.get(entry.relativePath) === 'import';
    });
    plan.drift.push(...remainingInstructionDrift);
    details.drift.push(...remainingInstructionDrift);

    if ((!options || !options.noImport) && remainingInstructionDrift.length > 0) {
        pulledBack.push(...await pullBackInstructionDrift(rootDir, remainingInstructionDrift, {
            ...options,
            ...(io || {})
        }));
    }

    const otherDrift = detectAllDrift(rootDir, { state }).filter((entry) => entry.type !== 'instruction');
    plan.drift.push(...otherDrift);
    details.drift.push(...otherDrift);
    if ((!options || !options.noImport) && otherDrift.length > 0) {
        pulledBack.push(...pullBackSkillsAndAgents(rootDir, otherDrift, options));
    }

    if (!options || !options.noExport) {
        const exportResult = exportInstructions(rootDir, { ...options, state });
        exported.push(...exportResult.exported);
        plan.export.push(...exportResult.exported);
        details.exports.push(...(exportResult.routes || []));

        const assetExportResult = exportSkillsAndAgents(rootDir, options);
        exported.push(...assetExportResult.exported);
        plan.export.push(...assetExportResult.exported);
        details.exports.push(...(assetExportResult.routes || []));
    }

    const pluginResult = syncPlugins(rootDir, state, options || {});
    pluginActions = pluginResult.actions;
    plan.plugins.push(...pluginActions);

    if (options && options.dryRun) {
        return {
            phase: 'dry-run',
            plan,
            imported,
            exported,
            pulledBack,
            pluginActions,
            details,
            backupTs: null
        };
    }

    const nextState = buildNextState(rootDir, state, discovered, pluginResult.state);
    saveState(rootDir, nextState);

    return {
        phase: 'completed',
        plan,
        imported,
        exported,
        pulledBack,
        pluginActions,
        details,
        backupTs: backup ? backup.timestamp : null
    };
}

function ensureHarnessFiles(rootDir, options) {
    const files = {
        '.harness/.gitignore': '.sync-state.json\nbackups/\n',
        '.harness/HARNESS.md': ''
    };

    for (const [relativePath, content] of Object.entries(files)) {
        const absolutePath = path.join(rootDir, relativePath);
        if (exists(absolutePath)) {
            continue;
        }
        if (options && options.dryRun) {
            continue;
        }
        writeUtf8(absolutePath, content);
    }
}

function detectInstructionConflicts(rootDir, state, driftEntries) {
    const conflicts = [];

    for (const entry of driftEntries) {
        const prior = (state.assets.instructions || []).find((item) => item.target === entry.relativePath);
        if (!prior) {
            continue;
        }

        const currentSourceHash = getCurrentSourceHash(rootDir, entry.llm);
        const currentTargetHash = hashString(entry.actual);
        const sourceChanged = prior.source_hash && currentSourceHash !== prior.source_hash;
        const targetChanged = prior.target_hash && currentTargetHash !== prior.target_hash;
        if (sourceChanged && targetChanged) {
            conflicts.push({
                type: 'instruction',
                llm: entry.llm,
                relativePath: entry.relativePath
            });
        }
    }

    return conflicts;
}

async function resolveInstructionConflicts(conflicts, options) {
    const decisions = new Map();

    for (const conflict of conflicts) {
        let resolution = null;
        if (options && typeof options.resolveConflict === 'function') {
            resolution = await options.resolveConflict(conflict);
        } else if (options && options.manualReview && typeof options.select === 'function') {
            resolution = await options.select(`Resolve conflict for ${conflict.relativePath}`, [
                { label: 'import project edits', value: 'import' },
                { label: 'export .harness state', value: 'export' }
            ]);
        }

        if (resolution === 'import' || resolution === 'export') {
            decisions.set(conflict.relativePath, resolution);
        }
    }

    return decisions;
}

function collectInitialBackupTargets(rootDir, discovered, state) {
    const paths = new Set([
        '.harness/HARNESS.md',
        '.harness/llm',
        '.harness/skills',
        '.harness/agents',
        '.harness/plugins.yaml',
        '.harness/.sync-state.json',
        '.harness/.gitignore'
    ]);

    for (const item of discovered) {
        paths.add(item.relativePath);
        paths.add(`.harness/llm/${item.llm}.md`);
        for (const target of getProfile(item.llm).instruction_files) {
            paths.add(target);
        }
    }

    for (const item of discoverHarnessAssets(rootDir)) {
        paths.add(item.source);
        paths.add(item.target);
    }

    for (const item of discoverSkillsAndAgents(rootDir)) {
        paths.add(item.relativePath);
    }

    for (const item of state.assets.instructions || []) {
        paths.add(item.target);
        paths.add(item.source);
    }
    return Array.from(paths);
}

function buildNextState(rootDir, state, discovered, plugins) {
    const instructions = [];
    for (const entry of buildInstructionExports(rootDir, { state })) {
        instructions.push({
            llm: entry.llm,
            source: `.harness/llm/${entry.llm}.md`,
            target: entry.relativePath,
            source_hash: getCurrentSourceHash(rootDir, entry.llm),
            target_hash: hashString(entry.expected)
        });
    }

    return {
        ...state,
        synced_at: formatOffsetDate(new Date()),
        assets: {
            instructions,
            skills: [],
            agents: []
        },
        classifications: {
            ...state.classifications,
            ...Object.fromEntries(discovered.map((entry) => [entry.relativePath, entry.llm]))
        },
        plugins
    };
}

function getCurrentSourceHash(rootDir, llm) {
    const commonPath = path.join(rootDir, '.harness', 'HARNESS.md');
    const llmPath = path.join(rootDir, '.harness', 'llm', `${llm}.md`);
    const commonContent = exists(commonPath) ? readUtf8(commonPath) : '';
    const llmContent = exists(llmPath) ? readUtf8(llmPath) : '';
    return hashString(`${commonContent}\n\0\n${llmContent}`);
}

module.exports = {
    runSync
};

function isFirstSync(state) {
    return !state.synced_at
        && (state.assets.instructions || []).length === 0
        && (state.assets.skills || []).length === 0
        && (state.assets.agents || []).length === 0;
}
