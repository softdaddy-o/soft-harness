const { spawnSync } = require('node:child_process');
const path = require('node:path');
const YAML = require('yaml');
const { getFsBackend } = require('./fs-backend');
const { hashDirectory, hashFile } = require('./hash');
const { createLink, isSymlink, readLink } = require('./symlink');
const { copyPath, ensureDir, exists, readUtf8, removePath, writeUtf8 } = require('./fs-util');
const { getProfile, listProfiles } = require('./profiles');

const MANAGED_MARKER = '.harness-managed';

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
                    hash: hashDirectory(skillDir, { ignore: [MANAGED_MARKER] })
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
        if (!outcome) {
            continue;
        }
        if (outcome.blocked) {
            routes.push({
                action: 'skip-export',
                type: entry.type,
                llm: entry.llm,
                from: entry.source,
                to: entry.target,
                reason: outcome.reason || null,
                detail: outcome.detail || null
            });
            continue;
        }

        const mode = outcome.mode;
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
    const rendered = renderManagedEntry(rootDir, entry);
    if (rendered.blocked) {
        return {
            blocked: true,
            reason: rendered.reason || null,
            detail: rendered.detail || null
        };
    }

    const desired = resolveManagedMode(rootDir, entry, options, rendered);
    const desiredMode = desired.mode;

    if (targetMatches(rootDir, entry, desiredMode)) {
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
    if (entry.type === 'skill') {
        if (rendered.skillContent !== null) {
            writeUtf8(path.join(absoluteTarget, 'SKILL.md'), rendered.skillContent);
        }
        writeUtf8(path.join(absoluteTarget, MANAGED_MARKER), [
            `source: ${entry.source}`,
            `content_hash: sha256:${hashDirectory(absoluteTarget, { ignore: [MANAGED_MARKER] })}`,
            'regenerate: soft-harness organize',
            ''
        ].join('\n'));
    } else {
        writeUtf8(`${absoluteTarget}.${MANAGED_MARKER}`, [
            `source: ${entry.source}`,
            `content_hash: sha256:${hashFile(absoluteTarget)}`,
            'regenerate: soft-harness organize',
            ''
        ].join('\n'));
    }
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
        const markerPath = path.join(absoluteTarget, MANAGED_MARKER);
        return exists(markerPath)
            && readUtf8(markerPath).includes(`content_hash: sha256:${hashDirectory(absoluteTarget, { ignore: [MANAGED_MARKER] })}`);
    }

    const markerPath = `${absoluteTarget}.${MANAGED_MARKER}`;
    return exists(markerPath)
        && readUtf8(markerPath).includes(`content_hash: sha256:${hashFile(absoluteTarget)}`);
}

function detectSkillsAndAgentsDrift(rootDir) {
    const drift = [];
    for (const entry of discoverHarnessAssets(rootDir)) {
        const absoluteSource = path.join(rootDir, entry.source);
        const absoluteTarget = path.join(rootDir, entry.target);

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

        if (entry.type === 'skill') {
            const markerPath = path.join(absoluteTarget, MANAGED_MARKER);
            const currentHash = hashDirectory(absoluteTarget, { ignore: [MANAGED_MARKER] });
            if (!exists(markerPath) || !readUtf8(markerPath).includes(`content_hash: sha256:${currentHash}`)) {
                drift.push({
                    type: 'skill',
                    mode: 'copy',
                    target: entry.target,
                    source: entry.source
                });
            }
            continue;
        }

        const markerPath = `${absoluteTarget}.${MANAGED_MARKER}`;
        const currentHash = hashFile(absoluteTarget);
        if (!exists(markerPath) || !readUtf8(markerPath).includes(`content_hash: sha256:${currentHash}`)) {
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

function resolveManagedMode(rootDir, entry, options, rendered) {
    const settings = options || {};
    const requestedMode = settings.linkMode || 'copy';
    if (requestedMode === 'copy') {
        return {
            mode: 'copy',
            reason: 'default-copy'
        };
    }

    if (rendered && rendered.requiresCopy) {
        return {
            mode: 'copy',
            reason: rendered.copyReason || 'host-specific-render'
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

function renderManagedEntry(rootDir, entry) {
    if (entry.type !== 'skill') {
        return {
            blocked: false,
            requiresCopy: false,
            copyReason: null,
            skillContent: null
        };
    }

    const skillPath = path.join(rootDir, entry.source, 'SKILL.md');
    const skillContent = readUtf8(skillPath);
    if (entry.llm !== 'codex') {
        return {
            blocked: false,
            requiresCopy: false,
            copyReason: null,
            skillContent
        };
    }

    return renderCodexSkillContent(skillContent);
}

function renderCodexSkillContent(skillContent) {
    const frontmatter = splitFrontmatter(skillContent);
    if (!frontmatter) {
        return {
            blocked: true,
            reason: 'codex-frontmatter-required',
            detail: 'SKILL.md is missing YAML frontmatter delimited by ---'
        };
    }

    const parsedOriginal = parseYamlFrontmatter(frontmatter.frontmatter);
    if (parsedOriginal.valid) {
        return {
            blocked: false,
            requiresCopy: false,
            copyReason: null,
            skillContent
        };
    }

    const normalizedFrontmatter = normalizeCodexFrontmatter(frontmatter.frontmatter);
    const parsedNormalized = parseYamlFrontmatter(normalizedFrontmatter);
    if (!parsedNormalized.valid) {
        return {
            blocked: true,
            reason: 'codex-frontmatter-invalid',
            detail: parsedNormalized.detail || parsedOriginal.detail || 'SKILL.md frontmatter is not valid YAML'
        };
    }

    return {
        blocked: false,
        requiresCopy: true,
        copyReason: 'codex-frontmatter-normalized',
        skillContent: `${frontmatter.opening}${frontmatter.eol}${normalizedFrontmatter}${frontmatter.eol}${frontmatter.closing}${frontmatter.suffix}`
    };
}

function splitFrontmatter(content) {
    const text = String(content || '');
    const match = text.match(/^(---)(\r?\n)([\s\S]*?)\r?\n(---)([\s\S]*)$/u);
    if (!match) {
        return null;
    }

    return {
        opening: match[1],
        eol: match[2],
        frontmatter: match[3],
        closing: match[4],
        suffix: match[5]
    };
}

function parseYamlFrontmatter(frontmatter) {
    try {
        const document = YAML.parseDocument(String(frontmatter || ''), {
            prettyErrors: false,
            strict: true
        });
        if (document.errors && document.errors.length > 0) {
            return {
                valid: false,
                detail: document.errors[0].message
            };
        }
        return {
            valid: true,
            detail: null
        };
    } catch (error) {
        return {
            valid: false,
            detail: error.message
        };
    }
}

function normalizeCodexFrontmatter(frontmatter) {
    return String(frontmatter || '')
        .split(/\r?\n/u)
        .map((line) => normalizeCodexFrontmatterLine(line))
        .join('\n');
}

function normalizeCodexFrontmatterLine(line) {
    const match = String(line || '').match(/^(\s*argument-hint\s*:\s*)(.+?)\s*$/u);
    if (!match) {
        return line;
    }

    const value = match[2].trim();
    if (!/\][ \t]+\[/u.test(value) || /^['"]/u.test(value)) {
        return line;
    }

    return `${match[1]}${JSON.stringify(value)}`;
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
        if (entry.type === 'skill') {
            removePath(path.join(absoluteSource, MANAGED_MARKER));
        }
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

module.exports = {
    MANAGED_MARKER,
    detectSkillsAndAgentsDrift,
    discoverHarnessAssets,
    discoverSkillsAndAgents,
    exportSkillsAndAgents,
    importSkillsAndAgents,
    pullBackSkillsAndAgents
};
