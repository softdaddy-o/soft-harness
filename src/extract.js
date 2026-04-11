const { hashString } = require('./hash');
const { normalizeHeadingText, parseMarkdownSections } = require('./md-parse');

function extractInstructionBuckets(files, options) {
    const maybeThreshold = (options && options.maybeThreshold) || 0.6;
    const parsed = files.map((file) => ({
        llm: file.llm,
        content: file.content,
        sections: parseMarkdownSections(file.content).map((section, index) => ({
            ...section,
            index,
            hash: hashString(`${normalizeHeadingText(section.heading)}\n${normalizeSectionBody(section.body)}`)
        }))
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
            commonContent: '',
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
            if (left.llm === right.llm) {
                continue;
            }
            if (normalizeHeadingText(left.section.heading) !== normalizeHeadingText(right.section.heading)) {
                continue;
            }

            const similarity = compareBodies(left.section.body, right.section.body);
            if (similarity >= maybeThreshold) {
                maybeSections.push({
                    heading: left.section.heading,
                    llms: [left.llm, right.llm],
                    similarity
                });
            }
        }
    }

    return {
        commonContent: renderSections(commonSections),
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

function normalizeSectionBody(body) {
    return String(body || '')
        .trim()
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
}

function compareBodies(left, right) {
    const leftBigrams = createBigrams(normalizeSectionBody(left).toLowerCase());
    const rightBigrams = createBigrams(normalizeSectionBody(right).toLowerCase());
    if (leftBigrams.length === 0 && rightBigrams.length === 0) {
        return 1;
    }

    const leftCounts = createCountMap(leftBigrams);
    const rightCounts = createCountMap(rightBigrams);
    let shared = 0;
    for (const [bigram, count] of leftCounts.entries()) {
        shared += Math.min(count, rightCounts.get(bigram) || 0);
    }

    return (2 * shared) / (leftBigrams.length + rightBigrams.length);
}

function createBigrams(value) {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length < 2) {
        return normalized ? [normalized] : [];
    }

    const bigrams = [];
    for (let index = 0; index < normalized.length - 1; index += 1) {
        bigrams.push(normalized.slice(index, index + 2));
    }
    return bigrams;
}

function createCountMap(items) {
    const counts = new Map();
    for (const item of items) {
        counts.set(item, (counts.get(item) || 0) + 1);
    }
    return counts;
}

module.exports = {
    extractInstructionBuckets
};
