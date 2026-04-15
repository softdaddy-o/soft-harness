const { loadPlugins, readInstalledPluginEntries } = require('../plugins');
const { createFinding } = require('./shared');
const { listProfiles } = require('../profiles');
const { findPluginOrigin, loadPluginOrigins } = require('../plugin-origins');
const { compareVersions } = require('../version');

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
                updateAvailable
            };
            plugins.push(enrichedPlugin);
            inventory.llmPacket.plugins.push({
                id: `plugins.plugin:${plugin.displayName || plugin.name}`,
                host: llm,
                display_name: plugin.displayName || plugin.name,
                name: plugin.name,
                registry: plugin.registry || null,
                installed_version: plugin.version || null,
                source_type: plugin.sourceType || 'declared',
                url: plugin.url || null,
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
                url: entry.url || null,
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

function hasCompleteCuration(origin) {
    return Boolean(origin && origin.sourceType && origin.latestVersion);
}

module.exports = {
    analyzePlugins
};
