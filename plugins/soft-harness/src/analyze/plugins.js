const { loadPlugins, readInstalledPluginEntries } = require('../plugins');
const { createFinding } = require('./shared');
const { listProfiles } = require('../profiles');
const { findPluginOrigin, loadPluginOrigins } = require('../plugin-origins');
const { compareVersions } = require('../version');
const path = require('node:path');
const { exists, readUtf8, walkFiles } = require('../fs-util');

async function analyzePlugins(rootDir, options) {
    const findings = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };
    const llmFilter = new Set((options && options.llms) || []);
    const llms = listProfiles().filter((llm) => llmFilter.size === 0 || llmFilter.has(llm));
    const desiredPlugins = loadPlugins(rootDir)
        .filter((plugin) => plugin.llms.some((llm) => llms.includes(llm)));

    const installedByLlm = new Map();
    for (const llm of llms) {
        installedByLlm.set(llm, readInstalledPluginEntries(rootDir, llm));
    }

    const inventory = {
        desired: desiredPlugins.map((plugin) => ({
            name: plugin.name,
            llms: plugin.llms.filter((llm) => llms.includes(llm)),
            version: plugin.version || null
        })),
        hosts: [],
        llmPacket: {
            schema_version: 1,
            instructions: [
                'Infer the most likely canonical source for each plugin and the latest available version.',
                'Prefer repository URLs only when the evidence is strong enough to name a specific repo.',
                'Return only JSON that matches output_schema.'
            ],
            output_schema: {
                plugin_origins: [{
                    plugin: '<display_name>',
                    hosts: ['<llm>'],
                    source_type: '<github|marketplace|unknown>',
                    repo: '<owner/repo|null>',
                    url: '<https url|null>',
                    latest_version: '<version|null>',
                    confidence: '<confirmed|llm-inferred|unknown>',
                    notes: '<short rationale>'
                }]
            },
            plugins: []
        }
    };
    const curatedOrigins = loadPluginOrigins(rootDir);

    for (const llm of llms) {
        const plugins = [];
        for (const plugin of installedByLlm.get(llm)) {
            const curatedOrigin = findPluginOrigin(curatedOrigins, llm, plugin);
            const latestVersion = curatedOrigin && curatedOrigin.latestVersion ? curatedOrigin.latestVersion : null;
            const updateCompare = latestVersion ? compareVersions(plugin.version, latestVersion) : null;
            const updateAvailable = updateCompare === -1;
            const enrichedPlugin = {
                ...plugin,
                curatedOrigin,
                latestVersion,
                updateAvailable,
                hooks: llm === 'codex' ? inspectCodexPluginHooks(rootDir, plugin) : []
            };
            plugins.push(enrichedPlugin);
            for (const hook of enrichedPlugin.hooks) {
                findings.unknown.push(createFinding('unknown', {
                    category: 'plugins',
                    kind: 'plugin-hook',
                    key: `plugins.hook:${plugin.displayName}:${hook.event}`,
                    sources: [{ llm, file: hook.file, path: hook.path }],
                    reason: hook.reason
                }));
            }
            inventory.llmPacket.plugins.push({
                id: `plugins.plugin:${plugin.displayName || plugin.name}`,
                host: llm,
                display_name: plugin.displayName || plugin.name,
                name: plugin.name,
                registry: plugin.registry || null,
                installed_version: plugin.version || null,
                source_type: plugin.sourceType || 'declared',
                repo: plugin.repo || null,
                url: plugin.url || null,
                source_path: plugin.sourcePath || null,
                git_commit_sha: plugin.gitCommitSha || null,
                author: plugin.author || null,
                description: plugin.description || null,
                evidence: plugin.evidence || null,
                needs_curation: !hasCompleteCuration(curatedOrigin)
            });
        }
        inventory.hosts.push({
            llm,
            plugins: plugins.sort((left, right) => left.displayName.localeCompare(right.displayName))
        });
    }

    const nameToLlms = new Map();
    for (const host of inventory.hosts) {
        for (const entry of host.plugins) {
            const name = entry.displayName || entry.name;
            if (!nameToLlms.has(name)) {
                nameToLlms.set(name, []);
            }
            nameToLlms.get(name).push({
                llm: host.llm,
                file: name,
                path: name,
                sourceType: entry.sourceType || 'declared',
                version: entry.version || null,
                registry: entry.registry || null,
                repo: entry.repo || null,
                url: entry.url || null,
                sourcePath: entry.sourcePath || null,
                gitCommitSha: entry.gitCommitSha || null,
                evidence: entry.evidence || null,
                curatedOrigin: entry.curatedOrigin || null
            });
        }
    }

    for (const [name, sources] of nameToLlms.entries()) {
        const llmSet = new Set(sources.map((source) => source.llm));
        if (llmSet.size >= 2) {
            findings.common.push(createFinding('common', {
                category: 'plugins',
                kind: 'plugin',
                key: `plugins.plugin:${name}`,
                sources,
                reason: 'plugin is installed across multiple hosts'
            }));
            continue;
        }

        findings.hostOnly.push(createFinding('hostOnly', {
            category: 'plugins',
            kind: 'plugin',
            key: `plugins.plugin:${name}`,
            sources,
            reason: 'plugin is installed on only one host'
        }));
    }

    return {
        findings,
        inventory
    };
}

function inspectCodexPluginHooks(rootDir, plugin) {
    const identity = resolveCodexPluginCacheIdentity(plugin);
    if (!identity) {
        return [{ event: 'manifest', file: '.codex/config.toml', path: '.codex/config.toml', reason: 'Codex plugin cache root cannot be resolved' }];
    }
    const cacheRoot = path.join(rootDir, '.codex', 'plugins', 'cache', identity.marketplace, identity.name);
    if (!exists(cacheRoot)) {
        return [{ event: 'manifest', file: '.codex/config.toml', path: '.codex/config.toml', reason: 'Codex plugin cache root cannot be resolved' }];
    }
    return walkFiles(cacheRoot, (relativePath) => {
        const normalized = relativePath.replace(/\\/gu, '/');
        return normalized.endsWith('hooks/hooks.json') || normalized.endsWith('.codex-plugin/plugin.json');
    }).flatMap((file) => file.relativePath.replace(/\\/gu, '/').endsWith('.codex-plugin/plugin.json')
        ? inspectPluginManifest(file.absolutePath, file.relativePath)
        : inspectHookFile(file.absolutePath, file.relativePath));
}

function resolveCodexPluginCacheIdentity(plugin) {
    const displayName = String((plugin && (plugin.displayName || plugin.name)) || '').trim();
    const separator = displayName.lastIndexOf('@');
    if (separator <= 0 || separator === displayName.length - 1) return null;
    const name = sanitizePathPart(displayName.slice(0, separator));
    const marketplace = sanitizePathPart(displayName.slice(separator + 1));
    return name && marketplace ? { name, marketplace } : null;
}

function inspectHookFile(filePath, relativePath) {
    try {
        const parsed = JSON.parse(readUtf8(filePath));
        const findings = [];
        for (const [event, groups] of Object.entries(parsed.hooks || {})) {
            for (const group of Array.isArray(groups) ? groups : []) {
                for (const handler of Array.isArray(group.hooks) ? group.hooks : []) {
                    if (typeof handler.command === 'string' && /\$\{CLAUDE_PLUGIN_ROOT\}/u.test(handler.command)) {
                        findings.push({ event, file: relativePath, path: relativePath, reason: `Codex hook ${event} still references \${CLAUDE_PLUGIN_ROOT}: ${handler.command}` });
                    }
                }
            }
        }
        return findings;
    } catch (error) {
        return [{ event: 'manifest', file: relativePath, path: relativePath, reason: 'Codex hook manifest is malformed' }];
    }
}

function inspectPluginManifest(filePath, relativePath) {
    try {
        const parsed = JSON.parse(readUtf8(filePath));
        if (!Object.prototype.hasOwnProperty.call(parsed, 'hooks')) return [];
        return [{ event: 'manifest', file: relativePath, path: relativePath, reason: 'Codex plugin manifest declares hook configuration; review required' }];
    } catch (error) {
        return [{ event: 'manifest', file: relativePath, path: relativePath, reason: 'Codex plugin manifest is malformed' }];
    }
}

function sanitizePathPart(value) {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-+|-+$/gu, '');
}

function hasCompleteCuration(origin) {
    return Boolean(origin && origin.sourceType && origin.latestVersion);
}

module.exports = {
    analyzePlugins
};
