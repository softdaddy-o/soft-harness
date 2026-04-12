const { analyzePrompts } = require('./analyze/prompts');
const { analyzeSettings } = require('./analyze/settings');
const { analyzeSkills } = require('./analyze/skills');
const { mergeFindings } = require('./analyze/shared');

async function runAnalyze(rootDir, options) {
    const categories = selectCategories(options);
    const parts = [];

    if (categories.includes('prompts')) {
        parts.push(await analyzePrompts(rootDir, options || {}));
    }
    if (categories.includes('settings')) {
        parts.push(analyzeSettings(rootDir, options || {}));
    }
    if (categories.includes('skills')) {
        parts.push(analyzeSkills(rootDir, options || {}));
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
        unknown: findings.unknown
    };
}

function selectCategories(options) {
    const category = options && options.category;
    if (!category || category === 'all') {
        return ['prompts', 'settings', 'skills'];
    }
    return [category];
}

module.exports = {
    runAnalyze
};
