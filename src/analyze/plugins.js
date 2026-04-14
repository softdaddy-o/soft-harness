const { loadPlugins, readInstalledPluginEntries } = require('../plugins');
const { createFinding } = require('./shared');
const { listProfiles } = require('../profiles');

function analyzePlugins(rootDir, options) {
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
        hosts: llms.map((llm) => ({
            llm,
            plugins: installedByLlm.get(llm).slice().sort((left, right) => left.displayName.localeCompare(right.displayName))
        }))
    };

    const nameToLlms = new Map();
    for (const [llm, entries] of installedByLlm.entries()) {
        for (const entry of entries) {
            const name = entry.displayName || entry.name;
            if (!nameToLlms.has(name)) {
                nameToLlms.set(name, []);
            }
            nameToLlms.get(name).push({
                llm,
                file: name,
                path: name,
                sourceType: entry.sourceType || 'declared',
                version: entry.version || null,
                registry: entry.registry || null,
                url: entry.url || null,
                evidence: entry.evidence || null
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
