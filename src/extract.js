const { hashString } = require('./hash');
const { parseMarkdownSections } = require('./md-parse');
const {
    compareSectionPair,
    createSectionRecord,
    getSectionMatchOptions,
    normalizeSectionBody
} = require('./section-match');

function extractInstructionBuckets(files, options) {
    const thresholds = getSectionMatchOptions(options);
    const parsed = files.map((file) => ({
        llm: file.llm,
        content: file.content,
        sections: parseMarkdownSections(file.content).map((section, index) => {
            const record = createSectionRecord(file.llm, section, {
                id: `${file.llm}:${index}`,
                index
            });
            return {
                ...record,
                hash: hashString(`${record.normalizedHeading}\n${record.normalizedBody}`)
            };
        })
    }));

    const llmSections = {};
    for (const file of parsed) {
        llmSections[file.llm] = [];
    }

    const commonSections = [];
    const maybeSections = [];

    if (parsed.length === 1) {
        llmSections[parsed[0].llm] = parsed[0].sections.slice();
        return {
            allSectionsByLlm: Object.fromEntries(parsed.map((file) => [file.llm, file.sections.slice()])),
            commonContent: '',
            commonSections,
            llmSections,
            llmContents: renderLlmContents(llmSections),
            maybeSections
        };
    }

    const groups = new Map();
    for (const file of parsed) {
        for (const section of file.sections) {
            if (!groups.has(section.hash)) {
                groups.set(section.hash, []);
            }
            groups.get(section.hash).push({
                llm: file.llm,
                section
            });
        }
    }

    const commonKeys = new Set();
    for (const members of groups.values()) {
        const llms = new Set(members.map((member) => member.llm));
        if (llms.size < 2) {
            continue;
        }

        const leader = members[0].section;
        commonSections.push(leader);
        for (const member of members) {
            commonKeys.add(sectionKey(member.llm, member.section.index));
        }
    }

    for (const file of parsed) {
        for (const section of file.sections) {
            if (!commonKeys.has(sectionKey(file.llm, section.index))) {
                llmSections[file.llm].push(section);
            }
        }
    }

    const uniqueSections = parsed.flatMap((file) => file.sections
        .filter((section) => !commonKeys.has(sectionKey(file.llm, section.index)))
        .map((section) => ({
            llm: file.llm,
            section
        })));

    for (let index = 0; index < uniqueSections.length; index += 1) {
        for (let inner = index + 1; inner < uniqueSections.length; inner += 1) {
            const left = uniqueSections[index];
            const right = uniqueSections[inner];
            const comparison = compareSectionPair(left.section, right.section, thresholds);
            if (left.llm === right.llm || !comparison.matched || comparison.bodyScore < thresholds.bodyThreshold) {
                continue;
            }
            if (comparison.bodyScore >= thresholds.bodyThreshold) {
                maybeSections.push({
                    heading: left.section.heading,
                    otherHeading: right.section.heading,
                    llms: [left.llm, right.llm],
                    sectionIds: [left.section.id, right.section.id],
                    similarity: comparison.bodyScore,
                    headingSimilarity: comparison.headingScore,
                    matchedBy: comparison.matchedBy
                });
            }
        }
    }

    return {
        allSectionsByLlm: Object.fromEntries(parsed.map((file) => [file.llm, file.sections.slice()])),
        commonContent: renderSections(commonSections),
        commonSections,
        llmSections,
        llmContents: renderLlmContents(llmSections),
        maybeSections
    };
}

function renderLlmContents(llmSections) {
    const result = {};
    for (const [llm, sections] of Object.entries(llmSections)) {
        result[llm] = renderSections(sections);
    }
    return result;
}

function renderSections(sections) {
    return sections.map((section) => section.raw.trim()).filter(Boolean).join('\n\n').trim();
}

function sectionKey(llm, index) {
    return `${llm}:${index}`;
}

module.exports = {
    extractInstructionBuckets
};
