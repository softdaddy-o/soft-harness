const { normalizeHeadingText } = require('../md-parse');

function normalizeText(value) {
    return String(value || '')
        .replace(/\r\n/g, '\n')
        .trim()
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n');
}

function similarity(left, right) {
    const leftBigrams = createBigrams(normalizeText(left).toLowerCase());
    const rightBigrams = createBigrams(normalizeText(right).toLowerCase());
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

function createCountMap(items) {
    const counts = new Map();
    for (const item of items) {
        counts.set(item, (counts.get(item) || 0) + 1);
    }
    return counts;
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

function createFinding(bucket, finding) {
    return {
        bucket,
        ...finding
    };
}

function mergeFindings(...findingSets) {
    const merged = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };

    for (const set of findingSets) {
        if (!set) {
            continue;
        }

        for (const key of Object.keys(merged)) {
            merged[key].push(...(set[key] || []));
        }
    }

    return merged;
}

function formatValuePreview(value) {
    if (value === null || value === undefined) {
        return String(value);
    }
    if (typeof value === 'string') {
        return value;
    }
    return JSON.stringify(value);
}

module.exports = {
    createFinding,
    formatValuePreview,
    mergeFindings,
    normalizeHeadingText,
    normalizeText,
    similarity
};
