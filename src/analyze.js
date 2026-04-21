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
    const scorecard = calculateAnalyzeScore(findings, inventory);
    return {
        summary: {
            common: findings.common.length,
            similar: findings.similar.length,
            conflicts: findings.conflicts.length,
            host_only: findings.hostOnly.length,
            unknown: findings.unknown.length
        },
        score: scorecard.score,
        score_reasons: scorecard.reasons,
        common: findings.common,
        similar: findings.similar,
        conflicts: findings.conflicts,
        host_only: findings.hostOnly,
        unknown: findings.unknown,
        inventory
    };
}

function calculateAnalyzeScore(findings, inventory) {
    const commonCount = (findings.common || []).length;
    const similarCount = (findings.similar || []).length;
    const conflictCount = (findings.conflicts || []).length;
    const hostOnlyCount = (findings.hostOnly || []).length;
    const unknownCount = (findings.unknown || []).length;
    const settingsConflictCount = (findings.conflicts || []).filter((entry) => entry.category === 'settings').length;
    const settingsSimilarCount = (findings.similar || []).filter((entry) => entry.category === 'settings').length;
    const settingsHostOnlyCount = (findings.hostOnly || []).filter((entry) => entry.category === 'settings').length;
    const settingsMisSyncCount = settingsSimilarCount + settingsHostOnlyCount;
    const nonSettingsConflictCount = conflictCount - settingsConflictCount;
    const parsedSettingsCount = (inventory.settings || []).filter((entry) => entry.status === 'parsed').length;
    const parseErrorCount = (inventory.settings || []).filter((entry) => entry.status === 'parse-error').length;
    const documentCount = (inventory.documents || []).length;
    const skillHostCount = (inventory.skills || []).length;
    const pluginHostCount = ((inventory.plugins || {}).hosts || []).length;
    const desiredPluginCount = ((inventory.plugins || {}).desired || []).length;

    const baseScore = 100
        - (conflictCount * 18)
        - (unknownCount * 12)
        - (parseErrorCount * 20)
        - (hostOnlyCount * 3)
        - (similarCount * 2)
        - (settingsConflictCount * 6)
        - (settingsMisSyncCount * 2)
        + Math.min(commonCount * 2, 10)
        + Math.min(parsedSettingsCount * 2, 6)
        + Math.min(documentCount, 3)
        + Math.min(skillHostCount, 3)
        + Math.min(pluginHostCount, 3)
        + Math.min(desiredPluginCount, 3);
    const score = Math.max(0, Math.min(100, Math.round(baseScore)));

    const reasons = [];

    if (settingsConflictCount > 0) {
        reasons.push(`${settingsConflictCount} LLM-specific settings conflict${settingsConflictCount === 1 ? '' : 's'} need manual resolution`);
    }
    if (settingsMisSyncCount > 0) {
        reasons.push(`${settingsMisSyncCount} LLM-specific settings item${settingsMisSyncCount === 1 ? '' : 's'} are out of sync across hosts`);
    }
    if (nonSettingsConflictCount > 0) {
        reasons.push(`${nonSettingsConflictCount} non-settings conflict${nonSettingsConflictCount === 1 ? '' : 's'} need manual resolution`);
    }
    if (unknownCount > 0) {
        reasons.push(`${unknownCount} unknown item${unknownCount === 1 ? '' : 's'} still need classification`);
    }
    if (parseErrorCount > 0) {
        reasons.push(`${parseErrorCount} settings file${parseErrorCount === 1 ? '' : 's'} failed to parse`);
    }
    if (hostOnlyCount > settingsHostOnlyCount) {
        const nonSettingsHostOnlyCount = hostOnlyCount - settingsHostOnlyCount;
        reasons.push(`${nonSettingsHostOnlyCount} host-only item${nonSettingsHostOnlyCount === 1 ? '' : 's'} may need cleanup or intentional separation`);
    }
    if (similarCount > settingsSimilarCount) {
        const nonSettingsSimilarCount = similarCount - settingsSimilarCount;
        reasons.push(`${nonSettingsSimilarCount} similar item${nonSettingsSimilarCount === 1 ? '' : 's'} may be candidates for alignment`);
    }
    if (hostOnlyCount > 0 && settingsMisSyncCount === 0) {
        reasons.push(`${hostOnlyCount} host-only item${hostOnlyCount === 1 ? '' : 's'} may need cleanup or intentional separation`);
    }
    if (commonCount > 0) {
        reasons.push(`${commonCount} shared item${commonCount === 1 ? '' : 's'} are already aligned across hosts`);
    }
    if (reasons.length === 0) {
        reasons.push('No major drift, conflict, or parse issues were detected');
    }

    return {
        score,
        reasons: reasons.slice(0, 4)
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
    calculateAnalyzeScore,
    runAnalyze
};
