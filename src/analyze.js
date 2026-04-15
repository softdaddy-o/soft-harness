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
        skillOrigins: {
            llmPacket: {
                schema_version: 1,
                instructions: [],
                output_schema: {
                    asset_origins: []
                },
                assets: []
            }
        },
        plugins: {
            desired: [],
            hosts: [],
            llmPacket: {
                schema_version: 1,
                instructions: [],
                output_schema: {
                    plugin_origins: []
                },
                plugins: []
            }
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
        inventory.skillOrigins.llmPacket.instructions = ((skillsResult.originsInventory && skillsResult.originsInventory.llmPacket) || {}).instructions || [];
        inventory.skillOrigins.llmPacket.output_schema = ((skillsResult.originsInventory && skillsResult.originsInventory.llmPacket) || {}).output_schema || { asset_origins: [] };
        inventory.skillOrigins.llmPacket.assets.push(...(((skillsResult.originsInventory && skillsResult.originsInventory.llmPacket) || {}).assets || []));
    }
    if (categories.includes('plugins')) {
        const pluginsResult = await analyzePlugins(rootDir, options || {});
        parts.push(pluginsResult.findings);
        inventory.plugins.desired.push(...((pluginsResult.inventory && pluginsResult.inventory.desired) || []));
        inventory.plugins.hosts.push(...((pluginsResult.inventory && pluginsResult.inventory.hosts) || []));
        inventory.plugins.llmPacket.instructions = ((pluginsResult.inventory && pluginsResult.inventory.llmPacket) || {}).instructions || [];
        inventory.plugins.llmPacket.output_schema = ((pluginsResult.inventory && pluginsResult.inventory.llmPacket) || {}).output_schema || { plugin_origins: [] };
        inventory.plugins.llmPacket.plugins.push(...(((pluginsResult.inventory && pluginsResult.inventory.llmPacket) || {}).plugins || []));
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
