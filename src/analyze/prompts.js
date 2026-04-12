const path = require('node:path');
const { parseMarkdownSections } = require('../md-parse');
const { hashString } = require('../hash');
const { discoverInstructions } = require('../discover');
const { exists, readUtf8 } = require('../fs-util');
const { extractImportStubDelta, parseConcatStub } = require('../stubs');
const { createFinding, normalizeHeadingText, normalizeText, similarity } = require('./shared');

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

    const sections = [];
    for (const entry of discovered) {
        if (llmFilter.size > 0 && !llmFilter.has(entry.llm)) {
            continue;
        }
        const resolved = resolvePromptContent(rootDir, entry);
        const parsed = parseMarkdownSections(resolved.content);
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

            sections.push({
                llm: entry.llm,
                file: resolved.file,
                heading: section.heading,
                body: section.body,
                raw: section.raw,
                hash: hashString(`${normalizeHeadingText(section.heading)}\n${normalizeText(section.body)}`)
            });
        }
    }

    const byHeading = new Map();
    for (const section of sections) {
        if (!byHeading.has(section.heading)) {
            byHeading.set(section.heading, []);
        }
        byHeading.get(section.heading).push(section);
    }

    for (const [heading, members] of byHeading.entries()) {
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
                key: `prompts.section:${heading}`,
                sources: group.map((item) => createSource(item, item)),
                reason: 'normalized section bodies are identical'
            }));
        }

        const groups = Array.from(byHash.values());
        if (groups.length > 1 && new Set(members.map((item) => item.llm)).size >= 2) {
            const comparison = comparePromptGroups(groups);
            findings[comparison.bucket].push(createFinding(comparison.bucket, {
                category: 'prompts',
                kind: 'section',
                key: `prompts.section:${heading}`,
                sources: members.map((item) => createSource(item, item)),
                reason: comparison.reason
            }));
            continue;
        }

        if (groups.length === 1 && new Set(members.map((item) => item.llm)).size === 1) {
            findings.hostOnly.push(createFinding('hostOnly', {
                category: 'prompts',
                kind: 'section',
                key: `prompts.section:${heading}`,
                sources: members.map((item) => createSource(item, item)),
                reason: 'section exists for only one host'
            }));
        }
    }

    return findings;
}

function comparePromptGroups(groups) {
    let bestSimilarity = 0;
    for (let index = 0; index < groups.length; index += 1) {
        for (let inner = index + 1; inner < groups.length; inner += 1) {
            const score = similarity(groups[index][0].body, groups[inner][0].body);
            bestSimilarity = Math.max(bestSimilarity, score);
        }
    }

    if (bestSimilarity >= 0.55) {
        return {
            bucket: 'similar',
            reason: `same section heading, but body content differs (similarity=${bestSimilarity.toFixed(2)})`
        };
    }

    return {
        bucket: 'conflicts',
        reason: 'same section heading, but body content is materially incompatible'
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
                content: parts.join('\n\n')
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
            content: parts.join('\n\n')
        };
    }

    return {
        file: entry.relativePath,
        content
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
