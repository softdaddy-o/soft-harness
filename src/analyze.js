const { analyzePrompts } = require('./analyze/prompts');
const { analyzeSettings } = require('./analyze/settings');
const { analyzeSkills } = require('./analyze/skills');
const { analyzePlugins } = require('./analyze/plugins');
const { mergeFindings } = require('./analyze/shared');

async function runAnalyze(rootDir, options) {
    const categories = selectCategories(options);
    const parts = [];
    const inventory = {
        documents: [],
        settings: [],
        skills: [],
        plugins: {
            desired: [],
            hosts: []
        }
    };

    if (categories.includes('prompts')) {
        const promptResult = await analyzePrompts(rootDir, options || {});
        parts.push(promptResult.findings);
        inventory.documents.push(...(promptResult.documents || []));
    }
    if (categories.includes('settings')) {
        const settingsResult = analyzeSettings(rootDir, options || {});
        parts.push(settingsResult.findings);
        inventory.settings.push(...(settingsResult.settings || []));
    }
    if (categories.includes('skills')) {
        const skillsResult = analyzeSkills(rootDir, options || {});
        parts.push(skillsResult.findings);
        inventory.skills.push(...(skillsResult.inventory || []));
    }
    if (categories.includes('plugins')) {
        const pluginsResult = analyzePlugins(rootDir, options || {});
        parts.push(pluginsResult.findings);
        inventory.plugins.desired.push(...((pluginsResult.inventory && pluginsResult.inventory.desired) || []));
        inventory.plugins.hosts.push(...((pluginsResult.inventory && pluginsResult.inventory.hosts) || []));
    }

    const findings = mergeFindings(...parts);
    return {
        summary: {
            common: findings.common.length,
            similar: findings.similar.length,
            conflicts: findings.conflicts.length,
            host_only: findings.hostOnly.length,
            unknown: findings.unknown.length
        },
        common: findings.common,
        similar: findings.similar,
        conflicts: findings.conflicts,
        host_only: findings.hostOnly,
        unknown: findings.unknown,
        inventory
    };
}

function selectCategories(options) {
    const category = options && options.category;
    if (!category || category === 'all') {
        return ['prompts', 'settings', 'skills', 'plugins'];
    }
    return [category];
}

module.exports = {
    runAnalyze
};
