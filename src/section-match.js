const { normalizeHeadingText } = require('./md-parse');
const { normalizeText, similarity } = require('./analyze/shared');

const DEFAULT_HEADING_THRESHOLD = 0.78;
const DEFAULT_BODY_THRESHOLD = 0.6;
const MIN_FUZZY_HEADING_LENGTH = 4;

function getSectionMatchOptions(options) {
    return {
        headingThreshold: normalizeThreshold(options && options.headingThreshold, DEFAULT_HEADING_THRESHOLD),
        bodyThreshold: normalizeThreshold(options && options.bodyThreshold, DEFAULT_BODY_THRESHOLD)
    };
}

function createSectionRecord(llm, section, extra) {
    const normalizedHeading = normalizeHeadingText(section.heading);
    return {
        ...extra,
        llm,
        heading: section.heading,
        normalizedHeading,
        body: section.body,
        normalizedBody: normalizeSectionBody(section.body),
        level: section.level,
        raw: section.raw
    };
}

function normalizeSectionBody(body) {
    return normalizeText(body);
}

function compareSectionPair(left, right, options) {
    const thresholds = getSectionMatchOptions(options);
    const exactHeading = left.normalizedHeading === right.normalizedHeading;
    const bodyScore = similarity(left.normalizedBody, right.normalizedBody);

    if (!left.normalizedHeading || !right.normalizedHeading) {
        return {
            matched: false,
            exactHeading,
            headingScore: 0,
            bodyScore,
            matchedBy: 'missing-heading'
        };
    }

    if (exactHeading) {
        return {
            matched: true,
            exactHeading: true,
            headingScore: 1,
            bodyScore,
            matchedBy: 'exact-heading'
        };
    }

    const headingScore = similarity(left.normalizedHeading, right.normalizedHeading);
    const minLength = Math.min(left.normalizedHeading.length, right.normalizedHeading.length);
    const matched = minLength >= MIN_FUZZY_HEADING_LENGTH && headingScore >= thresholds.headingThreshold;

    return {
        matched,
        exactHeading: false,
        headingScore,
        bodyScore,
        matchedBy: matched ? 'fuzzy-heading' : 'heading-miss'
    };
}

function findSectionMatchGroups(sections, options) {
    const comparisons = [];
    const adjacency = new Map(sections.map((section) => [section.id, new Set()]));
    const byId = new Map(sections.map((section) => [section.id, section]));

    for (let index = 0; index < sections.length; index += 1) {
        for (let inner = index + 1; inner < sections.length; inner += 1) {
            const left = sections[index];
            const right = sections[inner];
            if (left.llm === right.llm) {
                continue;
            }

            const comparison = compareSectionPair(left, right, options);
            if (!comparison.matched) {
                continue;
            }

            const record = {
                left,
                right,
                ...comparison
            };
            comparisons.push(record);
            adjacency.get(left.id).add(right.id);
            adjacency.get(right.id).add(left.id);
        }
    }

    const groups = [];
    const visited = new Set();

    for (const section of sections) {
        if (visited.has(section.id)) {
            continue;
        }

        const stack = [section.id];
        const memberIds = [];
        while (stack.length > 0) {
            const current = stack.pop();
            if (visited.has(current)) {
                continue;
            }
            visited.add(current);
            memberIds.push(current);
            for (const next of adjacency.get(current) || []) {
                if (!visited.has(next)) {
                    stack.push(next);
                }
            }
        }

        const members = memberIds.map((id) => byId.get(id));
        const memberSet = new Set(memberIds);
        const groupComparisons = comparisons.filter((comparison) => memberSet.has(comparison.left.id) && memberSet.has(comparison.right.id));
        groups.push({
            members,
            comparisons: groupComparisons
        });
    }

    return groups;
}

function normalizeThreshold(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) {
        throw new Error(`invalid threshold: ${value}`);
    }
    return numeric;
}

module.exports = {
    DEFAULT_BODY_THRESHOLD,
    DEFAULT_HEADING_THRESHOLD,
    compareSectionPair,
    createSectionRecord,
    findSectionMatchGroups,
    getSectionMatchOptions,
    normalizeSectionBody
};
