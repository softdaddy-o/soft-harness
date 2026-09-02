const path = require('node:path');
const { createBackup } = require('./backup');
const { discoverInstructions } = require('./discover');
const { detectAllDrift, detectInstructionDrift } = require('./drift');
const { buildInstructionState, exportInstructions, getCurrentSourceHash } = require('./export');
const { exists, formatOffsetDate, readUtf8, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { importInstructions } = require('./import');
const { collectCodexPluginMirrorCandidates, syncPlugins } = require('./plugins');
const { getProfile } = require('./profiles');
const { confirm } = require('./prompt');
const { pullBackInstructionDrift } = require('./pullback');
const { buildSettingsState, exportSettings } = require('./settings');
const { buildManagedAssetState, discoverHarnessAssets, discoverSkillsAndAgents, exportSkillsAndAgents, importSkillsAndAgents, pullBackSkillsAndAgents, removeCodexPluginFallbackAssets, validateManagedSkillExportSources } = require('./skills');
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
    const backupPlan = collectInitialBackupTargets(rootDir, discovered, state, options);
    const backup = (options && options.dryRun)
        ? null
        : createBackup(rootDir, backupPlan.paths, { reason: 'sync' });
    assertDisplacedTargetsAreRecoverable(backup, backupPlan.displaced);
    ensureHarnessFiles(rootDir, options);
    await resolveCodexPluginEnablement(rootDir, effectiveOptions);

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

        const skillImportResult = importSkillsAndAgents(rootDir, effectiveOptions);
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
        pulledBack.push(...pullBackSkillsAndAgents(rootDir, otherDrift, effectiveOptions));
    }

    if (!options || !options.noExport) {
        if (!options || !options.dryRun) {
            validateManagedSkillExportSources(rootDir, discoverHarnessAssets(rootDir));
        }

        const exportResult = exportInstructions(rootDir, { ...options, state });
        exported.push(...exportResult.exported);
        plan.export.push(...exportResult.exported);
        details.exports.push(...(exportResult.routes || []));

        const settingsExportResult = exportSettings(rootDir, options);
        exported.push(...settingsExportResult.exported);
        plan.export.push(...settingsExportResult.exported);
        details.exports.push(...(settingsExportResult.routes || []));

        const assetExportResult = exportSkillsAndAgents(rootDir, effectiveOptions);
        exported.push(...assetExportResult.exported);
        plan.export.push(...assetExportResult.exported);
        details.exports.push(...(assetExportResult.routes || []));
    }

    const pluginResult = syncPlugins(rootDir, state, effectiveOptions);
    pluginActions = pluginResult.actions;
    plan.plugins.push(...pluginActions);
    if (pluginResult.codexPluginMirrors && pluginResult.codexPluginMirrors.length > 0) {
        const cleanupActions = removeCodexPluginFallbackAssets(rootDir, pluginResult.codexPluginMirrors, effectiveOptions);
        pluginActions.push(...cleanupActions);
        plan.plugins.push(...cleanupActions);
    }

    if (options && options.dryRun) {
        return {
            phase: 'dry-run',
            plan,
            imported,
            exported,
            pulledBack,
            pluginActions,
            details,
            backupWarnings: [],
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
        backupWarnings: backup ? (backup.warnings || []) : [],
        backupTs: backup ? backup.timestamp : null
    };
}

async function resolveCodexPluginEnablement(rootDir, options) {
    if (!options || options.codexPluginsEnabled || options.dryRun || !options.interactive) {
        return;
    }

    const candidates = collectCodexPluginMirrorCandidates(rootDir);
    if (candidates.length === 0) {
        return;
    }

    const names = candidates.map((candidate) => candidate.installed.displayName || candidate.desired.name).join(', ');
    const enabled = await confirm(`Codex can mirror Claude plugin bundles for ${names}. Enable Codex plugins in Codex first, then sync these plugins now?`, options);
    if (enabled) {
        options.codexPluginsEnabled = true;
    }
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

// Why this run would write a path. Kept next to the paths themselves so the
// abort message can say what was about to happen to the file it could not
// back up.
const DISPLACED_EXPORT_TARGET = 'export target';
const DISPLACED_PULL_BACK = 'pull-back destination';
const DISPLACED_PLUGIN_MIRROR = 'Codex plugin mirror target';
const DISPLACED_SYNC_BOOKKEEPING = 'sync bookkeeping file';

// Returns every path worth backing up, plus the subset this run intends to
// overwrite or delete. The two come from one enumeration on purpose: a second
// list of "what gets written" would drift from the first.
function collectInitialBackupTargets(rootDir, discovered, state, options) {
    const targets = new Map();
    const add = (relativePath, displacedReason) => {
        if (!relativePath) {
            return;
        }
        targets.set(relativePath, targets.get(relativePath) || displacedReason || null);
    };

    const writesExports = !options || !options.noExport;
    const writesSources = !options || !options.noImport;

    // ensureHarnessFiles only writes these when they are absent, and an absent
    // file has nothing to back up, so they are never displaced.
    add('.harness/HARNESS.md');
    add('.harness/.gitignore');
    // Read during a sync, written only by the settings commands.
    add('.harness/settings');
    add('.harness/settings/portable.yaml');
    add('.harness/plugins.yaml');
    // Umbrella directories: the files under them that this run does write are
    // marked below, and containment covers a failure recorded against the
    // directory as a whole.
    add('.harness/llm');
    add('.harness/memory');
    add('.harness/agents');
    add('.harness/asset-origins.yaml', (writesExports || writesSources) && DISPLACED_SYNC_BOOKKEEPING);
    add('.harness/.sync-state.json', DISPLACED_SYNC_BOOKKEEPING);
    // Only a mirroring run rewrites these. Treating every interactive run as a
    // mirroring one -- because resolveCodexPluginEnablement can still say yes
    // later -- would put a marketplace-installed `plugins/` tree back under the
    // abort, and an unreadable link in a tree the run never writes is the exact
    // shape this branch exists to survive. See the ordering note below.
    const mirrorsCodexPlugins = Boolean(options && options.codexPluginsEnabled);
    add('.agents/plugins/marketplace.json', mirrorsCodexPlugins && DISPLACED_PLUGIN_MIRROR);
    add('plugins', mirrorsCodexPlugins && DISPLACED_PLUGIN_MIRROR);

    for (const item of discovered) {
        add(item.relativePath);
        add(`.harness/llm/${item.llm}.md`, writesSources && DISPLACED_PULL_BACK);
        add(`.harness/memory/llm/${item.llm}.md`, writesSources && DISPLACED_PULL_BACK);
        for (const target of getProfile(item.llm).instruction_files) {
            add(target, writesExports && DISPLACED_EXPORT_TARGET);
        }
    }

    for (const llm of ['claude', 'codex', 'gemini']) {
        const profile = getProfile(llm);
        if (profile.settings_file) {
            add(profile.settings_file, writesExports && DISPLACED_EXPORT_TARGET);
            add(`.harness/settings/llm/${llm}.yaml`);
        }
    }
    add('.harness/memory/shared.md', writesSources && DISPLACED_PULL_BACK);

    // Export writes targets, never sources, so a source only needs a backup
    // when pull-back can write into it -- that is, when import runs. Backing
    // up sources unconditionally meant traversing trees the run would never
    // touch, which is how a nested symlink in one of them could abort
    // everything. Shadowed sources are already excluded: discoverHarnessAssets
    // returns the plan, and a shadowed entry is never planned.
    for (const item of discoverHarnessAssets(rootDir)) {
        if (writesSources) {
            add(item.source, DISPLACED_PULL_BACK);
        }
        add(item.target, writesExports && DISPLACED_EXPORT_TARGET);
    }

    // Host assets the run reads to detect drift. A managed one is already an
    // export target above; the rest are never written, which is what keeps an
    // unreadable link in one of them from stopping an unrelated export.
    for (const item of discoverSkillsAndAgents(rootDir)) {
        add(item.relativePath);
    }

    for (const item of state.assets.instructions || []) {
        add(item.target, writesExports && DISPLACED_EXPORT_TARGET);
        add(item.source, writesSources && DISPLACED_PULL_BACK);
    }

    return {
        paths: Array.from(targets.keys()),
        displaced: new Map(Array.from(targets).filter(([, reason]) => reason))
    };
}

// A backup that could not capture a path is only survivable while the run
// leaves that path alone -- the 2026-09-01 EPERM was a link under a skill this
// run never writes, and stopping the whole sync for it was the bug. Overwriting
// a file whose backup failed is the opposite: the old bytes are gone and revert
// has nothing to put back, so refuse before anything is applied.
//
// Two writes decided after this point escape the gate, both for the same
// reason: moving the check to where they are decided would put it after the
// exports, which is the half-applied state this check exists to avoid.
// removeCodexPluginFallbackAssets deletes host assets chosen from
// pluginResult.codexPluginMirrors, which only exists once syncPlugins has run;
// and resolveCodexPluginEnablement can turn mirroring on after the backup, so
// a run that starts with it off does not treat `plugins/` as displaced.
function assertDisplacedTargetsAreRecoverable(backup, displaced) {
    if (!backup) {
        return;
    }

    const blocked = [];
    for (const warning of backup.warnings || []) {
        const displacedPath = findDisplacedPath(displaced, warning.path);
        if (displacedPath) {
            blocked.push(`${warning.path} (${warning.reason}) -- this run would write ${displacedPath} (${displaced.get(displacedPath)})`);
        }
    }

    if (blocked.length === 0) {
        return;
    }

    throw new Error(`backup failed for a path this run would overwrite, so no changes were applied: ${blocked.join('; ')}`);
}

// A failure is recorded against the path handed to createBackup, which may be
// a directory holding the displaced file, or a file inside a displaced
// directory. Either nesting means the displaced bytes were not captured.
function findDisplacedPath(displaced, failedPath) {
    const failed = normalizeRelativePath(failedPath);
    if (!failed) {
        return null;
    }

    for (const displacedPath of displaced.keys()) {
        const candidate = normalizeRelativePath(displacedPath);
        if (containsOrEquals(candidate, failed) || containsOrEquals(failed, candidate)) {
            return displacedPath;
        }
    }
    return null;
}

function containsOrEquals(ancestor, descendant) {
    return descendant === ancestor || descendant.startsWith(`${ancestor}/`);
}

function normalizeRelativePath(value) {
    return String(value || '').split('\\').join('/').replace(/\/+$/u, '');
}

function buildNextState(rootDir, state, discovered, plugins) {
    const instructions = buildInstructionState(rootDir, state);

    return {
        ...state,
        synced_at: formatOffsetDate(new Date()),
        assets: {
            instructions,
            settings: buildSettingsState(rootDir),
            ...buildManagedAssetState(rootDir)
        },
        classifications: {
            ...state.classifications,
            ...Object.fromEntries(discovered.map((entry) => [entry.relativePath, entry.llm]))
        },
        plugins
    };
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
