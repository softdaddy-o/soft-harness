const { loadPlugins, readInstalledPlugins } = require('../plugins');
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
        installedByLlm.set(llm, readInstalledPlugins(rootDir, llm));
    }

    const inventory = {
        desired: desiredPlugins.map((plugin) => ({
            name: plugin.name,
            llms: plugin.llms.filter((llm) => llms.includes(llm)),
            version: plugin.version || null
        })),
        hosts: llms.map((llm) => ({
            llm,
            plugins: installedByLlm.get(llm).slice().sort()
        }))
    };

    const nameToLlms = new Map();
    for (const [llm, names] of installedByLlm.entries()) {
        for (const name of names) {
            if (!nameToLlms.has(name)) {
                nameToLlms.set(name, new Set());
            }
            nameToLlms.get(name).add(llm);
        }
    }

    for (const [name, llmSet] of nameToLlms.entries()) {
        const sources = Array.from(llmSet).sort().map((llm) => ({
            llm,
            file: name,
            path: name
        }));
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
