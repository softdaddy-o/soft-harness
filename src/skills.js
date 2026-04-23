const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { getFsBackend } = require('./fs-backend');
const { hashDirectory, hashFile } = require('./hash');
const { createLink, isSymlink, readLink } = require('./symlink');
const { copyPath, ensureDir, exists, readUtf8, removePath, writeUtf8 } = require('./fs-util');
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
                if (!item.isFile() || !item.name.endsWith('.md')) {
                    continue;
                }
                const agentPath = path.join(agentsDir, item.name);
                items.push({
                    name: item.name.replace(/\.md$/, ''),
                    type: 'agent',
                    llm,
                    relativePath: path.posix.join(profile.agents_dir, item.name),
                    absolutePath: agentPath,
                    hash: hashFile(agentPath)
                });
            }
        }
    }

    return items;
}

function planBuckets(items, options) {
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
        if (members.length > 1 && sameHash) {
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
    const plan = planBuckets(discovered, options);
    const imported = [];
    const routes = [];

    for (const item of plan) {
        const relativeTarget = item.type === 'skill'
            ? `.harness/skills/${item.bucket}/${item.name}`
            : `.harness/agents/${item.bucket}/${item.name}.md`;
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

    return {
        imported,
        routes
    };
}

function exportSkillsAndAgents(rootDir, options) {
    const plan = discoverHarnessAssets(rootDir);
    const exported = [];
    const routes = [];

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
    copyPath(absoluteSource, absoluteTarget);
    removeLegacyManagedMarker(absoluteTarget, entry.type);
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
        return hashDirectory(absoluteSource) === hashDirectory(absoluteTarget);
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
        if (exists(agentsDir)) {
            for (const item of getFsBackend().readdirSync(agentsDir, { withFileTypes: true })) {
                if (!item.isFile() || !item.name.endsWith('.md')) {
                    continue;
                }

                const targets = bucket === 'common' ? listProfiles() : [bucket];
                for (const llm of targets) {
                    plan.push({
                        type: 'agent',
                        llm,
                        source: path.posix.join('.harness', 'agents', bucket, item.name),
                        target: path.posix.join(getProfile(llm).agents_dir, item.name)
                    });
                }
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

function detectLinkMode(absoluteTarget) {
    return process.platform === 'win32' ? 'junction' : 'symlink';
}

function removeLegacyManagedMarker(absoluteTarget, type) {
    const markerPath = type === 'skill'
        ? path.join(absoluteTarget, '.harness-managed')
        : `${absoluteTarget}.harness-managed`;
    removePath(markerPath);
}

module.exports = {
    buildManagedAssetState,
    detectSkillsAndAgentsDrift,
    discoverHarnessAssets,
    discoverSkillsAndAgents,
    exportSkillsAndAgents,
    importSkillsAndAgents,
    pullBackSkillsAndAgents
};
