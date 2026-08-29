const path = require('node:path');
const { parseMarkdownSections } = require('../md-parse');
const { hashString } = require('../hash');
const { discoverInstructions } = require('../discover');
const { exists, readUtf8 } = require('../fs-util');
const { compareSectionPair, createSectionRecord, findSectionMatchGroups, getSectionMatchOptions } = require('../section-match');
const { extractImportStubDelta, parseConcatStub } = require('../stubs');
const { createFinding, normalizeText } = require('./shared');

async function analyzePrompts(rootDir, options) {
    const discovered = await discoverInstructions(rootDir, {
        state: { classifications: {} },
        classifyAmbiguous(_relativePath, matches) {
            return matches[0];
        }
    });
    const llmFilter = new Set((options && options.llms) || []);
    const findings = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };
    const documents = [];

    const thresholds = getSectionMatchOptions(options);
    const sections = [];
    for (const entry of discovered) {
        if (llmFilter.size > 0 && !llmFilter.has(entry.llm)) {
            continue;
        }
        const resolved = resolvePromptContent(rootDir, entry);
        const parsed = parseMarkdownSections(resolved.content);
        documents.push({
            llm: entry.llm,
            file: entry.relativePath,
            mode: resolved.mode,
            sourceFiles: resolved.sourceFiles,
            headings: parsed.filter((section) => section.heading).length,
            sections: parsed.filter((section) => section.heading).map((section) => ({
                heading: section.heading,
                level: section.level
            })),
            untitledCount: parsed.filter((section) => !section.heading).length
        });
        for (const section of parsed) {
            if (!section.heading) {
                findings.unknown.push(createFinding('unknown', {
                    category: 'prompts',
                    kind: 'section',
                    key: `${resolved.file}#(untitled)`,
                    sources: [createSource({ ...entry, file: resolved.file }, section)],
                    reason: 'headingless content cannot be classified reliably'
                }));
                continue;
            }

            const record = createSectionRecord(entry.llm, section, {
                file: resolved.file,
                id: `${entry.llm}:${resolved.file}:${sections.length}`
            });
            sections.push({
                ...record,
                hash: hashString(`${record.normalizedHeading}\n${normalizeText(section.body)}`)
            });
        }
    }

    const exactGroups = new Map();
    for (const section of sections) {
        if (!exactGroups.has(section.normalizedHeading)) {
            exactGroups.set(section.normalizedHeading, []);
        }
        exactGroups.get(section.normalizedHeading).push(section);
    }

    const unmatched = [];
    for (const members of exactGroups.values()) {
        const byHash = new Map();
        for (const member of members) {
            if (!byHash.has(member.hash)) {
                byHash.set(member.hash, []);
            }
            byHash.get(member.hash).push(member);
        }

        const multiHostGroups = Array.from(byHash.values()).filter((group) => new Set(group.map((item) => item.llm)).size >= 2);
        for (const group of multiHostGroups) {
            findings.common.push(createFinding('common', {
                category: 'prompts',
                kind: 'section',
                key: `prompts.section:${group[0].heading}`,
                sources: group.map((item) => createSource(item, item)),
                reason: 'normalized section bodies are identical'
            }));
        }

        const remaining = Array.from(byHash.values()).filter((group) => new Set(group.map((item) => item.llm)).size === 1).flat();
        const uniqueLlms = new Set(remaining.map((item) => item.llm));
        if (remaining.length > 1 && uniqueLlms.size >= 2) {
            const comparison = comparePromptMembers(remaining, thresholds, 'exact-heading');
            findings[comparison.bucket].push(createFinding(comparison.bucket, {
                category: 'prompts',
                kind: 'section',
                key: `prompts.section:${remaining[0].heading}`,
                sources: remaining.map((item) => createSource(item, item)),
                reason: comparison.reason,
                score: comparison.score,
                headingScore: comparison.headingScore,
                bodyScore: comparison.bodyScore
            }));
            continue;
        }

        unmatched.push(...remaining);
    }

    const matchGroups = findSectionMatchGroups(unmatched, thresholds);
    for (const group of matchGroups) {
        const llms = new Set(group.members.map((item) => item.llm));
        if (llms.size === 1 || group.comparisons.length === 0) {
            for (const member of group.members) {
                findings.hostOnly.push(createFinding('hostOnly', {
                    category: 'prompts',
                    kind: 'section',
                    key: `prompts.section:${member.heading}`,
                    sources: [createSource(member, member)],
                    reason: 'section exists for only one host or has no comparable heading match'
                }));
            }
            continue;
        }

        const comparison = comparePromptMembers(group.members, thresholds, bestMatchMode(group.comparisons));
        findings[comparison.bucket].push(createFinding(comparison.bucket, {
            category: 'prompts',
            kind: 'section',
            key: `prompts.section:${group.members[0].heading}`,
            sources: group.members.map((item) => createSource(item, item)),
            reason: comparison.reason,
            score: comparison.score,
            headingScore: comparison.headingScore,
            bodyScore: comparison.bodyScore
        }));
    }

    return {
        findings,
        documents
    };
}

function resolvePromptContent(rootDir, entry) {
    const content = readUtf8(entry.absolutePath);
    const importRefs = extractHarnessRefs(content);
    if (importRefs.length > 0) {
        const parts = importRefs
            .map((relativePath) => path.join(rootDir, relativePath))
            .filter((absolutePath) => exists(absolutePath))
            .map((absolutePath) => readUtf8(absolutePath));
        const delta = extractImportStubDelta(content);
        if (delta) {
            parts.push(delta);
        }
        if (parts.length > 0) {
            return {
                file: entry.relativePath,
                content: parts.join('\n\n'),
                mode: 'import-stub',
                sourceFiles: importRefs
            };
        }
    }

    const parsedStub = parseConcatStub(content);
    if (parsedStub.blocks.length > 0) {
        const parts = parsedStub.blocks.map((block) => block.content).filter(Boolean);
        if (parsedStub.outside) {
            parts.push(parsedStub.outside);
        }
        return {
            file: entry.relativePath,
            content: parts.join('\n\n'),
            mode: 'concat-stub',
            sourceFiles: parsedStub.blocks.map((block) => block.path)
        };
    }

    return {
        file: entry.relativePath,
        content,
        mode: 'direct',
        sourceFiles: [entry.relativePath]
    };
}

function extractHarnessRefs(content) {
    return String(content || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('@.harness/'))
        .map((line) => line.slice(1));
}

function createSource(entry, section) {
    return {
        llm: entry.llm,
        file: entry.file || entry.relativePath,
        path: `${entry.file || entry.relativePath}#${section.heading || '(untitled)'}`
    };
}

module.exports = {
    analyzePrompts
};

function comparePromptMembers(members, thresholds, matchMode) {
    let bestBodyScore = 0;
    let bestHeadingScore = 0;

    for (let index = 0; index < members.length; index += 1) {
        for (let inner = index + 1; inner < members.length; inner += 1) {
            const left = members[index];
            const right = members[inner];
            if (left.llm === right.llm) {
                continue;
            }

            const comparison = compareSectionPair(left, right, thresholds);
            if (!comparison.matched) {
                continue;
            }
            bestBodyScore = Math.max(bestBodyScore, comparison.bodyScore);
            bestHeadingScore = Math.max(bestHeadingScore, comparison.headingScore);
        }
    }

    if (bestBodyScore >= thresholds.bodyThreshold) {
        const reason = matchMode === 'fuzzy-heading'
            ? `similar headings (${bestHeadingScore.toFixed(2)}), body content is near-match (${bestBodyScore.toFixed(2)})`
            : `same section heading, but body content differs (similarity=${bestBodyScore.toFixed(2)})`;
        return {
            bucket: 'similar',
            reason,
            score: bestBodyScore,
            headingScore: bestHeadingScore,
            bodyScore: bestBodyScore
        };
    }

    const reason = matchMode === 'fuzzy-heading'
        ? `similar headings (${bestHeadingScore.toFixed(2)}), but body content is materially incompatible (${bestBodyScore.toFixed(2)})`
        : 'same section heading, but body content is materially incompatible';
    return {
        bucket: 'conflicts',
        reason,
        headingScore: bestHeadingScore,
        bodyScore: bestBodyScore
    };
}

function bestMatchMode(comparisons) {
    return comparisons.some((comparison) => comparison.matchedBy === 'fuzzy-heading')
        ? 'fuzzy-heading'
        : 'exact-heading';
}
