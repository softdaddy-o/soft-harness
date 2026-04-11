const path = require('node:path');
const { exists, readUtf8 } = require('./fs-util');
const { buildInstructionExports } = require('./export');
const { detectSkillsAndAgentsDrift } = require('./skills');
const { detectPluginDrift } = require('./plugins');

function detectInstructionDrift(rootDir, options) {
    const entries = buildInstructionExports(rootDir, options);
    const managedTargets = new Set((((options && options.state) || {}).assets || {}).instructions?.map((entry) => entry.target) || []);
    const drift = [];

    for (const entry of entries) {
        if (!managedTargets.has(entry.relativePath)) {
            continue;
        }

        const absolutePath = path.join(rootDir, entry.relativePath);
        if (!exists(absolutePath)) {
            continue;
        }

        const current = readUtf8(absolutePath);
        if (current !== entry.expected) {
            drift.push({
                type: 'instruction',
                llm: entry.llm,
                relativePath: entry.relativePath,
                expected: entry.expected,
                actual: current
            });
        }
    }

    return drift;
}

function detectAllDrift(rootDir, options) {
    const instructionDrift = detectInstructionDrift(rootDir, options);
    const skillDrift = detectSkillsAndAgentsDrift(rootDir, options);
    const pluginDrift = detectPluginDrift(rootDir, options);
    return instructionDrift.concat(skillDrift, pluginDrift);
}

module.exports = {
    detectAllDrift,
    detectInstructionDrift
};
