const path = require('node:path');
const { discoverSkillsAndAgents } = require('../skills');
const { readUtf8 } = require('../fs-util');
const { createFinding, similarity } = require('./shared');

function analyzeSkills(rootDir, options) {
    const findings = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };
    const llmFilter = new Set((options && options.llms) || []);
    const discovered = discoverSkillsAndAgents(rootDir).filter((item) => llmFilter.size === 0 || llmFilter.has(item.llm));
    const grouped = new Map();

    for (const item of discovered) {
        const key = `${item.type}:${item.name}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(item);
    }

    for (const members of grouped.values()) {
        if (members.length === 1) {
            findings.hostOnly.push(createFinding('hostOnly', {
                category: 'skills',
                kind: members[0].type,
                key: `skills.${members[0].type}.${members[0].name}`,
                sources: members.map((member) => createSkillSource(member)),
                reason: `${members[0].type} exists for only one host`
            }));
            continue;
        }

        const uniqueHashes = new Set(members.map((member) => member.hash));
        if (uniqueHashes.size === 1) {
            findings.common.push(createFinding('common', {
                category: 'skills',
                kind: members[0].type,
                key: `skills.${members[0].type}.${members[0].name}`,
                sources: members.map((member) => createSkillSource(member)),
                reason: `${members[0].type} content is identical across hosts`
            }));
            continue;
        }

        const score = calculateSkillSimilarity(members);
        const bucket = score >= 0.55 ? 'similar' : 'conflicts';
        findings[bucket].push(createFinding(bucket, {
            category: 'skills',
            kind: members[0].type,
            key: `skills.${members[0].type}.${members[0].name}`,
            sources: members.map((member) => createSkillSource(member)),
            reason: bucket === 'similar'
                ? `${members[0].type} shares a name but differs by host`
                : `${members[0].type} shares a name but content is incompatible`
        }));
    }

    return findings;
}

function calculateSkillSimilarity(members) {
    let best = 0;
    for (let index = 0; index < members.length; index += 1) {
        for (let inner = index + 1; inner < members.length; inner += 1) {
            best = Math.max(best, similarity(readComparableContent(members[index]), readComparableContent(members[inner])));
        }
    }
    return best;
}

function readComparableContent(member) {
    if (member.type === 'skill') {
        return readUtf8(path.join(member.absolutePath, 'SKILL.md'));
    }
    return readUtf8(member.absolutePath);
}

function createSkillSource(member) {
    return {
        llm: member.llm,
        file: member.relativePath,
        path: member.relativePath
    };
}

module.exports = {
    analyzeSkills
};
