const { loadPlugins, readInstalledPluginEntries } = require('../plugins');
const { createFinding } = require('./shared');
const { listProfiles } = require('../profiles');
const { resolveGithubCandidate } = require('../github-search');

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
        hosts: []
    };

    for (const llm of llms) {
        const plugins = [];
        for (const plugin of installedByLlm.get(llm)) {
            const githubCandidate = await resolveGithubCandidate(plugin, options || {});
            plugins.push(githubCandidate ? { ...plugin, githubCandidate } : plugin);
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
                githubCandidate: entry.githubCandidate || null
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

module.exports = {
    analyzePlugins
};
