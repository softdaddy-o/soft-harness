const { spawnSync } = require('node:child_process');
const path = require('node:path');
const YAML = require('yaml');
const { loadAssetOrigins, saveAssetOrigins } = require('./asset-origins');
const { getFsBackend } = require('./fs-backend');
const { hashDirectory, hashFile } = require('./hash');
const { loadPlugins, readInstalledPluginEntries } = require('./plugins');
const { createLink, isSymlink, readLink } = require('./symlink');
const { copyPath, exists, readUtf8, removePath, walkFiles, writeUtf8 } = require('./fs-util');
const { getProfile, listProfiles } = require('./profiles');

function discoverSkillsAndAgents(rootDir) {
    const items = [];

    for (const llm of listProfiles()) {
        const profile = getProfile(llm);
        const skillsDir = path.join(rootDir, profile.skills_dir);
        if (exists(skillsDir)) {
            for (const item of getFsBackend().readdirSync(skillsDir, { withFileTypes: true })) {
                if (!item.isDirectory()) {
                    continue;
                }
                const skillDir = path.join(skillsDir, item.name);
                if (!exists(path.join(skillDir, 'SKILL.md'))) {
                    continue;
                }
                items.push({
                    name: item.name,
                    type: 'skill',
                    llm,
                    relativePath: path.posix.join(profile.skills_dir, item.name),
                    absolutePath: skillDir,
                    hash: hashDirectory(skillDir)
                });
            }
        }

        const agentsDir = path.join(rootDir, profile.agents_dir);
        if (exists(agentsDir)) {
            for (const item of getFsBackend().readdirSync(agentsDir, { withFileTypes: true })) {
                if (!item.isFile()) {
                    continue;
                }

                const extension = path.extname(item.name).toLowerCase();
                if (!getSupportedAgentExtensions(llm).includes(extension)) {
                    continue;
                }

                const agentPath = path.join(agentsDir, item.name);
                items.push({
                    name: item.name.slice(0, -extension.length),
                    type: 'agent',
                    llm,
                    extension,
                    relativePath: path.posix.join(profile.agents_dir, item.name),
                    absolutePath: agentPath,
                    hash: hashFile(agentPath)
                });
            }
        }
    }

    return items;
}

function planBuckets(items) {
    const grouped = new Map();
    for (const item of items) {
        const key = `${item.type}:${item.name}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(item);
    }

    const plan = [];
    for (const members of grouped.values()) {
        const sameHash = new Set(members.map((member) => member.hash)).size === 1;
        const sameAgentExtension = members.every((member) => member.type !== 'agent' || member.extension === members[0].extension);
        if (members.length > 1 && sameHash && sameAgentExtension) {
            for (const member of members) {
                plan.push({
                    ...member,
                    bucket: 'common'
                });
            }
            continue;
        }

        for (const member of members) {
            plan.push({
                ...member,
                bucket: member.llm
            });
        }
    }

    return plan;
}

function importSkillsAndAgents(rootDir, options) {
    const discovered = discoverSkillsAndAgents(rootDir);
    const plan = planBuckets(discovered);
    const imported = [];
    const routes = [];

    for (const item of plan) {
        const relativeTarget = item.type === 'skill'
            ? `.harness/skills/${item.bucket}/${item.name}`
            : `.harness/agents/${item.bucket}/${item.name}${item.extension || '.md'}`;
        const absoluteTarget = path.join(rootDir, relativeTarget);
        if (exists(absoluteTarget)) {
            continue;
        }

        imported.push({
            type: item.type,
            llm: item.llm,
            bucket: item.bucket,
            from: item.relativePath,
            to: relativeTarget
        });
        routes.push({
            action: 'bucket',
            type: item.type,
            name: item.name,
            llm: item.llm,
            bucket: item.bucket,
            from: item.relativePath,
            to: relativeTarget,
            reason: item.bucket === 'common' ? 'identical-across-llms' : 'llm-specific'
        });

        if (options && options.dryRun) {
            continue;
        }

        if (item.type === 'skill') {
            copyPath(item.absolutePath, absoluteTarget);
        } else {
            writeUtf8(absoluteTarget, readUtf8(item.absolutePath));
        }
    }

    const codexSkillPorts = importClaudePluginSkillsForCodex(rootDir, options);
    imported.push(...codexSkillPorts.imported);
    routes.push(...codexSkillPorts.routes);

    const codexPorts = importClaudeAgentsForCodex(rootDir, discovered, options);
    imported.push(...codexPorts.imported);
    routes.push(...codexPorts.routes);

    return {
        imported,
        routes
    };
}

function importClaudeAgentsForCodex(rootDir, discovered, options) {
    const imported = [];
    const routes = [];
    const assetOrigins = loadAssetOrigins(rootDir);
    let originsChanged = false;

    const sources = collectClaudeAgentPortSources(rootDir, discovered);
    for (const source of sources) {
        const relativeTarget = `.harness/agents/codex/${source.name}.toml`;
        const absoluteTarget = path.join(rootDir, relativeTarget);
        const desiredToml = buildCodexAgentToml(readUtf8(source.absolutePath), source.name);
        const nextOrigin = buildCodexAgentOrigin(source);
        const existingOrigin = findManagedCodexAgentOrigin(assetOrigins, source.name);
        const currentTarget = exists(absoluteTarget) ? readUtf8(absoluteTarget) : null;
        const originNeedsUpdate = !assetOriginsEqual(existingOrigin, nextOrigin);

        if (exists(absoluteTarget) && !canRefreshManagedCodexAgent(existingOrigin, source)) {
            continue;
        }
        if (currentTarget === desiredToml && !originNeedsUpdate) {
            if (!options || !options.dryRun) {
                removeLegacyCodexHarnessAgent(rootDir, source.name);
            }
            continue;
        }

        imported.push({
            type: 'agent',
            llm: 'codex',
            bucket: 'codex',
            from: source.relativePath,
            to: relativeTarget
        });
        routes.push({
            action: 'bucket',
            type: 'agent',
            name: source.name,
            llm: 'codex',
            bucket: 'codex',
            from: source.relativePath,
            to: relativeTarget,
            reason: source.plugin ? 'plugin-agent-port' : 'format-conversion-toml'
        });

        if (options && options.dryRun) {
            continue;
        }

        writeUtf8(absoluteTarget, desiredToml);
        removeLegacyCodexHarnessAgent(rootDir, source.name);
        upsertAssetOrigin(assetOrigins, nextOrigin);
        originsChanged = true;
    }

    if (originsChanged && (!options || !options.dryRun)) {
        saveAssetOrigins(rootDir, assetOrigins);
    }

    return {
        imported,
        routes
    };
}

function importClaudePluginSkillsForCodex(rootDir, options) {
    const imported = [];
    const routes = [];
    const assetOrigins = loadAssetOrigins(rootDir);
    let originsChanged = false;

    for (const source of discoverClaudePluginSkillsForCodex(rootDir)) {
        const relativeTarget = `.harness/skills/codex/${source.relativePath}`;
        const absoluteTarget = path.join(rootDir, relativeTarget);
        const nextOrigin = buildCodexSkillOrigin(source);
        const existingOrigin = findManagedCodexSkillOrigin(assetOrigins, source.name);
        const originNeedsUpdate = !assetOriginsEqual(existingOrigin, nextOrigin);

        if (exists(absoluteTarget) && !canRefreshManagedCodexSkill(existingOrigin, source)) {
            continue;
        }
        if (exists(absoluteTarget) && managedSkillTreesEqual(source.absolutePath, absoluteTarget) && !originNeedsUpdate) {
            continue;
        }

        imported.push({
            type: 'skill',
            llm: 'codex',
            bucket: 'codex',
            from: source.relativeSourcePath,
            to: relativeTarget
        });
        routes.push({
            action: 'bucket',
            type: 'skill',
            name: source.name,
            llm: 'codex',
            bucket: 'codex',
            from: source.relativeSourcePath,
            to: relativeTarget,
            reason: 'plugin-skill-port'
        });

        if (options && options.dryRun) {
            continue;
        }

        removePath(absoluteTarget);
        copyManagedAsset(source.absolutePath, absoluteTarget, { type: 'skill', validate: false });
        if (source.hasSkill) {
            upsertAssetOrigin(assetOrigins, nextOrigin);
            originsChanged = true;
        }
    }

    if (originsChanged && (!options || !options.dryRun)) {
        saveAssetOrigins(rootDir, assetOrigins);
    }

    return {
        imported,
        routes
    };
}

function collectClaudeAgentPortSources(rootDir, discovered) {
    const selected = new Map();

    for (const item of discovered) {
        if (item.type !== 'agent' || item.llm !== 'claude' || item.extension !== '.md') {
            continue;
        }
        if (!selected.has(item.name)) {
            selected.set(item.name, item);
        }
    }

    for (const item of discoverClaudePluginAgentsForCodex(rootDir)) {
        if (!selected.has(item.name)) {
            selected.set(item.name, item);
        }
    }

    return Array.from(selected.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function discoverClaudePluginAgentsForCodex(rootDir) {
    const desired = loadPlugins(rootDir).filter((plugin) => Array.isArray(plugin.llms) && plugin.llms.includes('codex'));
    if (desired.length === 0) {
        return [];
    }

    const installed = readInstalledPluginEntries(rootDir, 'claude');
    const agents = [];

    for (const plugin of desired) {
        const installedEntry = matchInstalledClaudePlugin(plugin, installed);
        if (!installedEntry || !installedEntry.installPath) {
            continue;
        }

        const installRoot = resolveInstallRoot(rootDir, installedEntry.installPath);
        const agentsDir = path.join(installRoot, 'agents');
        if (!exists(agentsDir)) {
            continue;
        }

        for (const item of getFsBackend().readdirSync(agentsDir, { withFileTypes: true })) {
            if (!item.isFile() || path.extname(item.name).toLowerCase() !== '.md') {
                continue;
            }

            const agentPath = path.join(agentsDir, item.name);
            agents.push({
                name: item.name.replace(/\.md$/u, ''),
                type: 'agent',
                llm: 'claude',
                extension: '.md',
                relativePath: toPosixRelative(rootDir, agentPath),
                absolutePath: agentPath,
                hash: hashFile(agentPath),
                plugin: installedEntry
            });
        }
    }

    return dedupePluginAgents(agents);
}

function discoverClaudePluginSkillsForCodex(rootDir) {
    const desired = loadPlugins(rootDir).filter((plugin) => Array.isArray(plugin.llms) && plugin.llms.includes('codex'));
    if (desired.length === 0) {
        return [];
    }

    const installed = readInstalledPluginEntries(rootDir, 'claude');
    const skills = [];

    for (const plugin of desired) {
        const installedEntry = matchInstalledClaudePlugin(plugin, installed);
        if (!installedEntry || !installedEntry.installPath) {
            continue;
        }

        const installRoot = resolveInstallRoot(rootDir, installedEntry.installPath);
        const skillsRoot = path.join(installRoot, 'skills');
        if (!exists(skillsRoot)) {
            continue;
        }

        for (const member of collectPluginSkillTreeMembers(rootDir, skillsRoot)) {
            skills.push({
                ...member,
                plugin: installedEntry
            });
        }
    }

    return dedupePluginSkillMembers(skills);
}

function collectPluginSkillTreeMembers(rootDir, skillsRoot) {
    const members = [];
    for (const entry of getFsBackend().readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
            continue;
        }

        const absolutePath = path.join(skillsRoot, entry.name);
        const relativePath = toPosixRelative(skillsRoot, absolutePath);
        const hasSkill = exists(path.join(absolutePath, 'SKILL.md'));
        const isSharedSupport = entry.name === 'references';
        if (!hasSkill && !isSharedSupport && !directoryContainsSkillMarkdown(absolutePath)) {
            continue;
        }

        members.push({
            name: entry.name,
            type: 'skill',
            llm: 'claude',
            absolutePath,
            relativePath,
            relativeSourcePath: toPosixRelative(rootDir, absolutePath),
            hash: hashDirectory(absolutePath),
            hasSkill
        });
    }
    return members;
}

function directoryContainsSkillMarkdown(rootDir) {
    return walkFiles(rootDir, (relativePath) => path.posix.basename(relativePath) === 'SKILL.md').length > 0;
}

function dedupePluginSkillMembers(items) {
    const grouped = new Map();
    for (const item of items) {
        if (!grouped.has(item.relativePath)) {
            grouped.set(item.relativePath, []);
        }
        grouped.get(item.relativePath).push(item);
    }

    const selected = [];
    for (const candidates of grouped.values()) {
        if (candidates.length === 1) {
            selected.push(candidates[0]);
        }
    }

    return selected.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function exportSkillsAndAgents(rootDir, options) {
    const plan = discoverHarnessAssets(rootDir);
    const exported = [];
    const routes = [];
    const skillTargetsToValidate = [];

    for (const entry of plan) {
        const outcome = ensureManagedTarget(rootDir, entry, options);
        const mode = outcome && outcome.mode;
        if (!mode) {
            continue;
        }

        exported.push({
            type: entry.type,
            from: entry.source,
            to: entry.target,
            mode
        });
        if ((!options || !options.dryRun) && entry.type === 'skill' && !isSharedSupportDirectory(entry.target)) {
            skillTargetsToValidate.push(path.join(rootDir, entry.target));
        }
        routes.push({
            action: 'export',
            type: entry.type,
            llm: entry.llm,
            from: entry.source,
            to: entry.target,
            mode,
            reason: outcome.reason || null
        });
    }

    if (!options || !options.dryRun) {
        for (const targetPath of skillTargetsToValidate) {
            validateManagedSkillTree(targetPath);
        }
    }

    return {
        exported,
        routes
    };
}

function ensureManagedTarget(rootDir, entry, options) {
    const absoluteSource = path.join(rootDir, entry.source);
    const absoluteTarget = path.join(rootDir, entry.target);
    const desired = resolveManagedMode(rootDir, entry, options);
    const desiredMode = desired.mode;

    if (targetMatches(rootDir, entry, desiredMode)) {
        if (!options || !options.dryRun) {
            removeLegacyManagedMarker(absoluteTarget, entry.type);
            removeLegacyCodexExportAgent(rootDir, entry);
        }
        return null;
    }

    if (options && options.dryRun) {
        return {
            mode: desiredMode === 'copy' ? 'planned-copy' : `planned-${desiredMode}`,
            reason: desired.reason || null
        };
    }

    if (desiredMode !== 'copy') {
        const link = createLink(absoluteSource, absoluteTarget, { prefer: desiredMode });
        if (link.mode !== 'copy') {
            return {
                mode: link.mode,
                reason: desired.reason || null
            };
        }
    }

    removePath(absoluteTarget);
    copyManagedAsset(absoluteSource, absoluteTarget, { ...entry, validate: true });
    removeLegacyManagedMarker(absoluteTarget, entry.type);
    removeLegacyCodexExportAgent(rootDir, entry);
    return {
        mode: 'copy',
        reason: desired.reason || null
    };
}

function targetMatches(rootDir, entry, desiredMode) {
    const absoluteSource = path.join(rootDir, entry.source);
    const absoluteTarget = path.join(rootDir, entry.target);
    if (!exists(absoluteTarget)) {
        return false;
    }

    if (isSymlink(absoluteTarget)) {
        if (desiredMode === 'copy') {
            return false;
        }
        const targetValue = readLink(absoluteTarget).replace(/\\/g, '/');
        return targetValue.endsWith(entry.source.replace(/\\/g, '/'))
            || path.resolve(path.dirname(absoluteTarget), targetValue) === absoluteSource;
    }

    if (desiredMode !== 'copy') {
        return false;
    }

    if (entry.type === 'skill') {
        return managedSkillTreesEqual(absoluteSource, absoluteTarget);
    }

    return hashFile(absoluteSource) === hashFile(absoluteTarget);
}

function detectSkillsAndAgentsDrift(rootDir, options) {
    const drift = [];
    const managed = buildManagedAssetIndex(options && options.state);
    for (const entry of discoverHarnessAssets(rootDir)) {
        const absoluteSource = path.join(rootDir, entry.source);
        const absoluteTarget = path.join(rootDir, entry.target);
        const prior = managed.get(getManagedAssetKey(entry));

        if (!prior) {
            continue;
        }
        if (!exists(absoluteTarget)) {
            continue;
        }

        if (isSymlink(absoluteTarget)) {
            const targetValue = readLink(absoluteTarget).replace(/\\/g, '/');
            const expectedSuffix = absoluteSource.replace(/\\/g, '/');
            if (!targetValue.endsWith(entry.source.replace(/\\/g, '/')) && targetValue !== expectedSuffix) {
                drift.push({
                    type: entry.type,
                    mode: 'symlink',
                    target: entry.target,
                    source: entry.source
                });
            }
            continue;
        }

        if (prior.mode === 'symlink' || prior.mode === 'junction') {
            drift.push({
                type: entry.type,
                mode: prior.mode,
                target: entry.target,
                source: entry.source
            });
            continue;
        }

        if (entry.type === 'skill') {
            const currentHash = hashDirectory(absoluteTarget);
            if (prior.target_hash !== currentHash) {
                drift.push({
                    type: 'skill',
                    mode: 'copy',
                    target: entry.target,
                    source: entry.source
                });
            }
            continue;
        }

        const currentHash = hashFile(absoluteTarget);
        if (prior.target_hash !== currentHash) {
            drift.push({
                type: 'agent',
                mode: 'copy',
                target: entry.target,
                source: entry.source
            });
        }
    }

    return drift;
}

function resolveManagedMode(rootDir, entry, options) {
    const settings = options || {};
    const requestedMode = settings.linkMode || 'copy';
    if (requestedMode === 'copy') {
        return {
            mode: 'copy',
            reason: 'default-copy'
        };
    }

    const absoluteTarget = path.resolve(rootDir, entry.target);
    if (isRepoInternalPath(rootDir, absoluteTarget)
        && !settings.forceExportUntrackedHosts
        && !isGitIgnored(rootDir, entry.target)) {
        return {
            mode: 'copy',
            reason: 'downgraded-not-gitignored'
        };
    }

    if (requestedMode === 'junction' && entry.type === 'skill') {
        return {
            mode: 'junction',
            reason: 'explicit-junction'
        };
    }

    return {
        mode: 'symlink',
        reason: 'explicit-symlink'
    };
}

function isRepoInternalPath(rootDir, absoluteTarget) {
    const relativePath = path.relative(path.resolve(rootDir), absoluteTarget);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isGitIgnored(rootDir, relativePath) {
    const result = spawnSync('git', ['check-ignore', '--quiet', relativePath], {
        cwd: rootDir,
        stdio: 'ignore'
    });
    return result.status === 0;
}

function pullBackSkillsAndAgents(rootDir, driftEntries, options) {
    const pulledBack = [];

    for (const entry of driftEntries) {
        if (entry.type !== 'skill' && entry.type !== 'agent') {
            continue;
        }

        const absoluteTarget = path.join(rootDir, entry.target);
        const absoluteSource = path.join(rootDir, entry.source);
        if (!exists(absoluteTarget)) {
            continue;
        }

        removePath(absoluteSource);
        copyPath(absoluteTarget, absoluteSource);
        pulledBack.push({
            from: entry.target,
            to: entry.source
        });
    }

    if (!options || !options.dryRun) {
        exportSkillsAndAgents(rootDir, options);
    }

    return pulledBack;
}

function removeCodexPluginFallbackAssets(rootDir, pluginMirrors, options) {
    const pluginNames = new Set((pluginMirrors || []).flatMap((plugin) => {
        return [plugin && plugin.name, plugin && plugin.displayName, plugin && plugin.installedName].filter(Boolean);
    }));
    if (pluginNames.size === 0) {
        return [];
    }

    const removed = [];
    const assetOrigins = loadAssetOrigins(rootDir);
    let originsChanged = false;

    for (const source of discoverClaudePluginSkillsForCodex(rootDir)) {
        if (!pluginNames.has(getPluginSourceName(source.plugin))) {
            continue;
        }

        const harnessTarget = path.posix.join('.harness', 'skills', 'codex', source.relativePath);
        const exportTarget = path.posix.join(getProfile('codex').skills_dir, source.relativePath);
        if (!canRemoveCodexPluginSkillFallback(rootDir, source, harnessTarget, assetOrigins)) {
            continue;
        }

        removeFallbackPath(rootDir, harnessTarget, removed, options);
        removeFallbackPath(rootDir, exportTarget, removed, options);
        if (removeAssetOrigin(assetOrigins, 'skill', source.name)) {
            originsChanged = true;
        }
    }

    for (const source of discoverClaudePluginAgentsForCodex(rootDir)) {
        if (!pluginNames.has(getPluginSourceName(source.plugin))) {
            continue;
        }

        const existingOrigin = findManagedCodexAgentOrigin(assetOrigins, source.name);
        if (!canRefreshManagedCodexAgent(existingOrigin, source)) {
            continue;
        }

        removeFallbackPath(rootDir, path.posix.join('.harness', 'agents', 'codex', `${source.name}.toml`), removed, options);
        removeFallbackPath(rootDir, path.posix.join(getProfile('codex').agents_dir, `${source.name}.toml`), removed, options);
        if (removeAssetOrigin(assetOrigins, 'agent', source.name)) {
            originsChanged = true;
        }
    }

    if (originsChanged && (!options || !options.dryRun)) {
        saveAssetOrigins(rootDir, assetOrigins);
    }

    return removed;
}

function discoverHarnessAssets(rootDir) {
    const plan = [];

    for (const bucket of ['common', ...listProfiles()]) {
        const skillsDir = path.join(rootDir, '.harness', 'skills', bucket);
        if (exists(skillsDir)) {
            for (const item of getFsBackend().readdirSync(skillsDir, { withFileTypes: true })) {
                if (!item.isDirectory()) {
                    continue;
                }

                const targets = bucket === 'common' ? listProfiles() : [bucket];
                for (const llm of targets) {
                    plan.push({
                        type: 'skill',
                        llm,
                        source: path.posix.join('.harness', 'skills', bucket, item.name),
                        target: path.posix.join(getProfile(llm).skills_dir, item.name)
                    });
                }
            }
        }

        const agentsDir = path.join(rootDir, '.harness', 'agents', bucket);
        if (!exists(agentsDir)) {
            continue;
        }

        for (const item of getFsBackend().readdirSync(agentsDir, { withFileTypes: true })) {
            if (!item.isFile()) {
                continue;
            }

            const extension = path.extname(item.name).toLowerCase();
            if (!SUPPORTED_AGENT_EXTENSIONS.has(extension)) {
                continue;
            }

            const name = item.name.slice(0, -extension.length);
            const targets = bucket === 'common' ? listProfiles() : [bucket];
            for (const llm of targets) {
                if (!getSupportedAgentExtensions(llm).includes(extension)) {
                    continue;
                }

                plan.push({
                    type: 'agent',
                    llm,
                    source: path.posix.join('.harness', 'agents', bucket, item.name),
                    target: path.posix.join(getProfile(llm).agents_dir, `${name}${getPreferredAgentExtension(llm)}`),
                    extension
                });
            }
        }
    }

    return plan;
}

function buildManagedAssetState(rootDir) {
    const state = {
        skills: [],
        agents: []
    };

    for (const entry of discoverHarnessAssets(rootDir)) {
        const absoluteTarget = path.join(rootDir, entry.target);
        if (!exists(absoluteTarget)) {
            continue;
        }

        const record = {
            target: entry.target,
            source: entry.source,
            mode: isSymlink(absoluteTarget) ? detectLinkMode(absoluteTarget) : 'copy',
            target_hash: null
        };

        if (record.mode === 'copy') {
            record.target_hash = entry.type === 'skill'
                ? hashDirectory(absoluteTarget)
                : hashFile(absoluteTarget);
        }

        if (entry.type === 'skill') {
            state.skills.push(record);
        } else {
            state.agents.push(record);
        }
    }

    return state;
}

function buildManagedAssetIndex(state) {
    const index = new Map();
    const assets = (state && state.assets) || state || {};

    for (const entry of assets.skills || []) {
        index.set(`skill:${entry.target}`, entry);
    }
    for (const entry of assets.agents || []) {
        index.set(`agent:${entry.target}`, entry);
    }

    return index;
}

function getManagedAssetKey(entry) {
    return `${entry.type}:${entry.target}`;
}

function detectLinkMode() {
    return process.platform === 'win32' ? 'junction' : 'symlink';
}

function removeLegacyManagedMarker(absoluteTarget, type) {
    const markerPath = type === 'skill'
        ? path.join(absoluteTarget, '.harness-managed')
        : `${absoluteTarget}.harness-managed`;
    removePath(markerPath);
}

function getSupportedAgentExtensions(llm) {
    return llm === 'codex' ? ['.toml'] : ['.md'];
}

function getPreferredAgentExtension(llm) {
    return llm === 'codex' ? '.toml' : '.md';
}

function removeLegacyCodexHarnessAgent(rootDir, agentName) {
    removePath(path.join(rootDir, '.harness', 'agents', 'codex', `${agentName}.yaml`));
    removePath(path.join(rootDir, '.harness', 'agents', 'codex', `${agentName}.yml`));
}

function removeLegacyCodexExportAgent(rootDir, entry) {
    if (entry.type !== 'agent' || entry.llm !== 'codex' || path.extname(entry.target).toLowerCase() !== '.toml') {
        return;
    }

    const targetDir = path.dirname(path.join(rootDir, entry.target));
    const targetName = path.basename(entry.target, '.toml');
    for (const extension of ['.yaml', '.yml']) {
        const legacyPath = path.join(targetDir, `${targetName}${extension}`);
        if (!exists(legacyPath)) {
            continue;
        }
        if (isLegacyCodexYamlStub(readUtf8(legacyPath))) {
            removePath(legacyPath);
        }
    }
}

function isLegacyCodexYamlStub(content) {
    return /^\s*interface:\s*$/mu.test(String(content || ''));
}

function matchInstalledClaudePlugin(desiredPlugin, installedEntries) {
    if (!desiredPlugin || !desiredPlugin.name) {
        return null;
    }

    const exact = installedEntries.find((entry) => entry.displayName === desiredPlugin.name);
    if (exact) {
        return exact;
    }

    const bareNameMatches = installedEntries.filter((entry) => entry.name === desiredPlugin.name);
    if (bareNameMatches.length === 1) {
        return bareNameMatches[0];
    }

    return null;
}

function resolveInstallRoot(rootDir, installPath) {
    return path.isAbsolute(installPath) ? installPath : path.join(rootDir, installPath);
}

function dedupePluginAgents(items) {
    const grouped = new Map();
    for (const item of items) {
        if (!grouped.has(item.name)) {
            grouped.set(item.name, []);
        }
        grouped.get(item.name).push(item);
    }

    const selected = [];
    for (const candidates of grouped.values()) {
        if (candidates.length === 1) {
            selected.push(candidates[0]);
        }
    }

    return selected;
}

function buildCodexAgentToml(content, fallbackName) {
    const parsed = parseClaudeAgentMarkdown(content, fallbackName);
    return [
        `name = ${toTomlBasicString(parsed.displayName)}`,
        `description = ${toTomlBasicString(parsed.shortDescription)}`,
        `developer_instructions = ${toTomlMultilineString(parsed.developerInstructions)}`,
        ''
    ].join('\n');
}

function parseClaudeAgentMarkdown(content, fallbackName) {
    const parsed = extractFrontmatter(content);
    const frontmatter = parsed.frontmatter || {};
    const body = parsed.body || '';
    const displayName = cleanText(frontmatter.name) || extractTitle(body) || titleizeSlug(fallbackName);
    const shortDescription = truncateText(cleanText(frontmatter.description) || extractFirstMeaningfulParagraph(body) || `Claude agent for ${displayName}.`, 220);
    return {
        displayName,
        shortDescription,
        developerInstructions: normalizeDeveloperInstructions(body, displayName, shortDescription)
    };
}

function extractFrontmatter(content) {
    const text = String(content || '');
    if (!text.startsWith('---')) {
        return { frontmatter: null, body: text };
    }

    const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u);
    if (!match) {
        return { frontmatter: null, body: text };
    }

    try {
        return {
            frontmatter: YAML.parse(match[1]) || {},
            body: match[2]
        };
    } catch (error) {
        return {
            frontmatter: parseSimpleFrontmatter(match[1]),
            body: match[2]
        };
    }
}

function parseSimpleFrontmatter(content) {
    const frontmatter = {};
    for (const line of String(content || '').replace(/\r\n/g, '\n').split('\n')) {
        const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
        if (!match) {
            continue;
        }
        frontmatter[match[1]] = match[2];
    }
    return frontmatter;
}

function extractTitle(content) {
    const match = String(content || '').match(/^#\s+(.+?)\s*$/mu);
    return match ? cleanText(match[1]) : null;
}

function extractFirstMeaningfulParagraph(content) {
    const paragraph = splitParagraphs(content)
        .map((value) => cleanText(stripMarkdown(value)))
        .find((value) => value && value.length >= 20);
    return paragraph || null;
}

function splitParagraphs(content) {
    const lines = String(content || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter((line) => !/^---\s*$/u.test(line.trim()))
        .filter((line) => !/^#\s+/u.test(line.trim()));

    const paragraphs = [];
    let current = [];
    for (const line of lines) {
        if (!line.trim()) {
            if (current.length > 0) {
                paragraphs.push(current.join(' '));
                current = [];
            }
            continue;
        }
        current.push(line.trim());
    }
    if (current.length > 0) {
        paragraphs.push(current.join(' '));
    }

    return paragraphs;
}

function stripMarkdown(content) {
    return String(content || '')
        .replace(/`([^`]+)`/gu, '$1')
        .replace(/\*\*([^*]+)\*\*/gu, '$1')
        .replace(/\*([^*]+)\*/gu, '$1')
        .replace(/_([^_]+)_/gu, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
        .replace(/^[-*]\s+/gmu, '')
        .replace(/\s+/gu, ' ')
        .trim();
}

function cleanText(value) {
    const text = String(value || '').replace(/\s+/gu, ' ').trim();
    return text || null;
}

function copyManagedAsset(sourcePath, targetPath, entry) {
    copyPath(sourcePath, targetPath);
    if (!entry || entry.type !== 'skill') {
        return;
    }
    normalizeSkillMarkdownTree(targetPath);
}

function normalizeSkillMarkdownTree(rootDir) {
    for (const file of walkFiles(rootDir, (relativePath) => path.posix.basename(relativePath) === 'SKILL.md')) {
        const relativeDir = path.posix.dirname(file.relativePath);
        const fallbackName = relativeDir === '.'
            ? path.basename(rootDir)
            : path.posix.basename(relativeDir);
        writeUtf8(file.absolutePath, normalizeSkillMarkdown(readUtf8(file.absolutePath), fallbackName));
    }
}

function normalizeSkillMarkdown(content, fallbackName) {
    const parsed = extractFrontmatter(content);
    const frontmatter = parsed.frontmatter && typeof parsed.frontmatter === 'object'
        ? { ...parsed.frontmatter }
        : {};
    const body = String(parsed.body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/^\n/u, '');
    const name = cleanText(frontmatter.name) || extractTitle(body) || titleizeSlug(fallbackName);
    const description = cleanText(frontmatter.description)
        || extractFirstMeaningfulParagraph(body)
        || `Skill for ${name}.`;
    const nextFrontmatter = {
        ...frontmatter,
        name,
        description
    };
    const serializedFrontmatter = Object.entries(nextFrontmatter)
        .map(([key, value]) => serializeSkillFrontmatterEntry(key, value))
        .join('\n');
    return `---\n${serializedFrontmatter}\n---\n\n${body}`;
}

function validateManagedSkillTree(rootDir) {
    for (const file of walkFiles(rootDir, (relativePath) => path.posix.basename(relativePath) === 'SKILL.md')) {
        const skillDir = path.dirname(file.absolutePath);
        const content = readUtf8(file.absolutePath);
        for (const relativeRef of collectLocalMarkdownReferences(content)) {
            const absoluteRef = path.resolve(skillDir, relativeRef);
            if (!exists(absoluteRef)) {
                throw new Error(`managed skill export is missing referenced file: ${relativeRef}`);
            }
        }
    }
}

function collectLocalMarkdownReferences(content) {
    const references = new Set();
    const text = String(content || '');
    const patterns = [
        /`((?:\.\.?\/)[^`\r\n]+)`/gu,
        /\[[^\]]+\]\(((?:\.\.?\/)[^)]+)\)/gu
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const value = cleanText(match[1]);
            if (!value) {
                continue;
            }
            references.add(value.split('#')[0]);
        }
    }

    return Array.from(references).filter(Boolean);
}

function isSharedSupportDirectory(relativeTarget) {
    return path.posix.basename(relativeTarget) === 'references';
}

function serializeSkillFrontmatterEntry(key, value) {
    if (key === 'description') {
        return `${key}: ${toQuotedYamlString(value)}`;
    }
    return YAML.stringify({ [key]: value }).trimEnd();
}

function toQuotedYamlString(value) {
    return `"${String(value || '')
        .replace(/\\/gu, '\\\\')
        .replace(/"/gu, '\\"')}"`;
}

function managedSkillTreesEqual(sourceDir, targetDir) {
    const sourceFiles = walkFiles(sourceDir);
    const targetFiles = walkFiles(targetDir);
    if (sourceFiles.length !== targetFiles.length) {
        return false;
    }

    const targetByRelativePath = new Map(targetFiles.map((file) => [file.relativePath, file.absolutePath]));
    for (const sourceFile of sourceFiles) {
        const targetFile = targetByRelativePath.get(sourceFile.relativePath);
        if (!targetFile) {
            return false;
        }
        if (path.posix.basename(sourceFile.relativePath) === 'SKILL.md') {
            const relativeDir = path.posix.dirname(sourceFile.relativePath);
            const fallbackName = relativeDir === '.'
                ? path.basename(sourceDir)
                : path.posix.basename(relativeDir);
            const normalizedSource = normalizeSkillMarkdown(readUtf8(sourceFile.absolutePath), fallbackName);
            const normalizedTarget = normalizeSkillMarkdown(readUtf8(targetFile), fallbackName);
            if (normalizedSource !== normalizedTarget) {
                return false;
            }
            continue;
        }
        if (hashFile(sourceFile.absolutePath) !== hashFile(targetFile)) {
            return false;
        }
    }

    return true;
}

function truncateText(value, maxLength) {
    const text = cleanText(value);
    if (!text || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

function titleizeSlug(value) {
    const words = String(value || '')
        .split(/[-_]+/u)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`);
    return words.join(' ') || 'Agent';
}

function normalizeDeveloperInstructions(body, displayName, shortDescription) {
    const normalized = String(body || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (normalized) {
        return normalized;
    }
    return `# ${displayName}\n\n${shortDescription}`;
}

function toTomlBasicString(value) {
    const text = escapeTomlControlCharacters(String(value || ''))
        .replace(/\\/g, '\\\\')
        .replace(/\r/g, '')
        .replace(/\n/g, '\\n')
        .replace(/"/g, '\\"');
    return `"${text}"`;
}

function toTomlMultilineString(value) {
    const text = escapeTomlControlCharacters(String(value || ''))
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\\/g, '\\\\')
        .replace(/"""/g, '\\"""');
    return `"""\n${text}\n"""`;
}

function escapeTomlControlCharacters(value) {
    return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, (character) => {
        return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
    });
}

function buildCodexAgentOrigin(source) {
    const plugin = source.plugin || null;
    return {
        kind: 'agent',
        asset: source.name,
        hosts: ['codex'],
        plugin: plugin ? (plugin.displayName || plugin.name || null) : null,
        sourceType: plugin ? (plugin.sourceType || 'marketplace') : 'local',
        repo: plugin ? (plugin.repo || null) : null,
        url: plugin ? buildPluginAgentUrl(plugin, source.name) : null,
        sourcePath: plugin ? joinSourcePath(plugin.sourcePath, `agents/${source.name}.md`) : source.relativePath,
        installedVersion: plugin ? (plugin.version || null) : null,
        latestVersion: null,
        gitCommitSha: plugin ? (plugin.gitCommitSha || null) : null,
        confidence: plugin && (plugin.repo || plugin.url) ? 'confirmed' : null,
        notes: plugin
            ? `Generated as a Codex TOML agent from Claude plugin agent ${plugin.displayName || plugin.name}.`
            : 'Generated as a Codex TOML agent from a Claude markdown agent.'
    };
}

function buildPluginAgentUrl(plugin, agentName) {
    const sourcePath = joinSourcePath(plugin.sourcePath, `agents/${agentName}.md`);
    if (plugin.repo && sourcePath) {
        return `https://github.com/${plugin.repo}/tree/main/${sourcePath}`;
    }
    return plugin.url || (plugin.repo ? `https://github.com/${plugin.repo}` : null);
}

function buildCodexSkillOrigin(source) {
    const plugin = source.plugin || null;
    return {
        kind: 'skill',
        asset: source.name,
        hosts: ['codex'],
        plugin: plugin ? (plugin.displayName || plugin.name || null) : null,
        sourceType: plugin ? (plugin.sourceType || 'marketplace') : 'local',
        repo: plugin ? (plugin.repo || null) : null,
        url: plugin ? buildPluginSkillUrl(plugin, source.relativePath) : null,
        sourcePath: plugin ? joinSourcePath(plugin.sourcePath, `skills/${source.relativePath}`) : source.relativeSourcePath,
        installedVersion: plugin ? (plugin.version || null) : null,
        latestVersion: null,
        gitCommitSha: plugin ? (plugin.gitCommitSha || null) : null,
        confidence: plugin && (plugin.repo || plugin.url) ? 'confirmed' : null,
        notes: plugin
            ? `Generated as a Codex skill from Claude plugin skill ${plugin.displayName || plugin.name}.`
            : 'Generated as a Codex skill from a Claude skill.'
    };
}

function buildPluginSkillUrl(plugin, relativePath) {
    const sourcePath = joinSourcePath(plugin.sourcePath, `skills/${relativePath}`);
    if (plugin.repo && sourcePath) {
        return `https://github.com/${plugin.repo}/tree/main/${sourcePath}`;
    }
    return plugin.url || (plugin.repo ? `https://github.com/${plugin.repo}` : null);
}

function joinSourcePath(basePath, suffix) {
    const parts = [basePath, suffix]
        .map((value) => String(value || '').replace(/\\/g, '/').replace(/^\/+/u, '').replace(/\/+$/u, ''))
        .filter(Boolean);
    return parts.length > 0 ? parts.join('/') : null;
}

function findManagedCodexAgentOrigin(origins, agentName) {
    return (origins || []).find((origin) => origin.kind === 'agent'
        && origin.asset === agentName
        && Array.isArray(origin.hosts)
        && origin.hosts.length === 1
        && origin.hosts[0] === 'codex') || null;
}

function findManagedCodexSkillOrigin(origins, skillName) {
    return (origins || []).find((origin) => origin.kind === 'skill'
        && origin.asset === skillName
        && Array.isArray(origin.hosts)
        && origin.hosts.length === 1
        && origin.hosts[0] === 'codex') || null;
}

function canRefreshManagedCodexAgent(origin, source) {
    if (!origin) {
        return false;
    }
    if (source.plugin) {
        return origin.plugin === (source.plugin.displayName || source.plugin.name || null);
    }
    return !origin.plugin && origin.sourcePath === source.relativePath;
}

function canRefreshManagedCodexSkill(origin, source) {
    if (!origin) {
        return false;
    }
    if (source.plugin) {
        return origin.plugin === (source.plugin.displayName || source.plugin.name || null)
            && origin.sourcePath === joinSourcePath(source.plugin.sourcePath, `skills/${source.relativePath}`);
    }
    return !origin.plugin && origin.sourcePath === source.relativeSourcePath;
}

function assetOriginsEqual(left, right) {
    if (!left || !right) {
        return false;
    }
    return left.kind === right.kind
        && left.asset === right.asset
        && JSON.stringify(left.hosts || []) === JSON.stringify(right.hosts || [])
        && left.plugin === right.plugin
        && left.sourceType === right.sourceType
        && left.repo === right.repo
        && left.url === right.url
        && left.sourcePath === right.sourcePath
        && left.installedVersion === right.installedVersion
        && left.latestVersion === right.latestVersion
        && left.gitCommitSha === right.gitCommitSha
        && left.confidence === right.confidence
        && left.notes === right.notes;
}

function upsertAssetOrigin(origins, nextOrigin) {
    const index = (origins || []).findIndex((origin) => origin.kind === nextOrigin.kind
        && origin.asset === nextOrigin.asset
        && JSON.stringify(origin.hosts || []) === JSON.stringify(nextOrigin.hosts || []));
    if (index === -1) {
        origins.push(nextOrigin);
        return;
    }
    origins[index] = nextOrigin;
}

function removeAssetOrigin(origins, kind, asset) {
    const index = (origins || []).findIndex((origin) => origin.kind === kind
        && origin.asset === asset
        && Array.isArray(origin.hosts)
        && origin.hosts.length === 1
        && origin.hosts[0] === 'codex');
    if (index === -1) {
        return false;
    }
    origins.splice(index, 1);
    return true;
}

function getPluginSourceName(plugin) {
    return plugin ? (plugin.displayName || plugin.name || null) : null;
}

function canRemoveCodexPluginSkillFallback(rootDir, source, harnessTarget, assetOrigins) {
    const absoluteHarnessTarget = path.join(rootDir, harnessTarget);
    if (!exists(absoluteHarnessTarget)) {
        return false;
    }

    if (source.hasSkill) {
        const existingOrigin = findManagedCodexSkillOrigin(assetOrigins, source.name);
        return canRefreshManagedCodexSkill(existingOrigin, source);
    }

    return managedSkillTreesEqual(source.absolutePath, absoluteHarnessTarget);
}

function removeFallbackPath(rootDir, relativePath, removed, options) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!exists(absolutePath)) {
        return;
    }

    removed.push({
        type: 'codex-plugin-fallback',
        path: relativePath
    });

    if (options && options.dryRun) {
        return;
    }
    removePath(absolutePath);
}

function toPosixRelative(rootDir, absolutePath) {
    return path.relative(rootDir, absolutePath).split(path.sep).join('/');
}

const SUPPORTED_AGENT_EXTENSIONS = new Set(['.md', '.toml']);

module.exports = {
    buildManagedAssetState,
    detectSkillsAndAgentsDrift,
    discoverHarnessAssets,
    discoverSkillsAndAgents,
    exportSkillsAndAgents,
    importSkillsAndAgents,
    removeCodexPluginFallbackAssets,
    pullBackSkillsAndAgents
};
