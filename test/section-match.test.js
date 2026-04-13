const test = require('node:test');
const assert = require('node:assert/strict');
const {
    DEFAULT_BODY_THRESHOLD,
    DEFAULT_HEADING_THRESHOLD,
    compareSectionPair,
    createSectionRecord,
    findSectionMatchGroups,
    getSectionMatchOptions,
    normalizeSectionBody
} = require('../src/section-match');

function makeSection(llm, heading, body, id) {
    return createSectionRecord(llm, {
        heading,
        body,
        level: 2,
        raw: `## ${heading}\n${body}`
    }, { id });
}

test('section-match: defaults, normalization, and invalid thresholds are handled', () => {
    assert.deepEqual(getSectionMatchOptions({}), {
        headingThreshold: DEFAULT_HEADING_THRESHOLD,
        bodyThreshold: DEFAULT_BODY_THRESHOLD
    });
    assert.deepEqual(getSectionMatchOptions({ headingThreshold: '', bodyThreshold: null }), {
        headingThreshold: DEFAULT_HEADING_THRESHOLD,
        bodyThreshold: DEFAULT_BODY_THRESHOLD
    });
    assert.equal(normalizeSectionBody('foo\r\n\r\nbar'), 'foo\n\nbar');
    assert.throws(() => getSectionMatchOptions({ headingThreshold: 2 }), /invalid threshold/i);
});

test('section-match: compareSectionPair covers missing headings, exact headings, fuzzy headings, and misses', () => {
    const missingHeading = compareSectionPair(
        makeSection('claude', '', 'body', 'a'),
        makeSection('codex', 'Heading', 'body', 'b')
    );
    assert.equal(missingHeading.matched, false);
    assert.equal(missingHeading.matchedBy, 'missing-heading');

    const exact = compareSectionPair(
        makeSection('claude', 'Git Conventions', 'same body', 'a'),
        makeSection('codex', 'Git Conventions', 'same body', 'b')
    );
    assert.equal(exact.matched, true);
    assert.equal(exact.matchedBy, 'exact-heading');
    assert.equal(exact.headingScore, 1);

    const fuzzy = compareSectionPair(
        makeSection('claude', 'Repository Overview', 'close body', 'a'),
        makeSection('codex', 'Repo Overview', 'close body', 'b'),
        { headingThreshold: 0.7, bodyThreshold: 0.5 }
    );
    assert.equal(fuzzy.matched, true);
    assert.equal(fuzzy.matchedBy, 'fuzzy-heading');

    const miss = compareSectionPair(
        makeSection('claude', 'Git', 'body', 'a'),
        makeSection('codex', 'Guide', 'body', 'b'),
        { headingThreshold: 0.7, bodyThreshold: 0.5 }
    );
    assert.equal(miss.matched, false);
    assert.equal(miss.matchedBy, 'heading-miss');
});

test('section-match: findSectionMatchGroups creates connected groups and leaves unmatched sections isolated', () => {
    const sections = [
        makeSection('claude', 'Repository Overview', 'same workflow', 'claude:1'),
        makeSection('codex', 'Repo Overview', 'same workflow', 'codex:1'),
        makeSection('gemini', 'Repo Summary', 'same workflow', 'gemini:1'),
        makeSection('claude', 'Only Claude', 'solo', 'claude:2'),
        makeSection('claude', 'Same LLM', 'ignored', 'claude:3')
    ];

    const groups = findSectionMatchGroups(sections, {
        headingThreshold: 0.65,
        bodyThreshold: 0.5
    });

    assert.equal(groups.length, 4);
    const multiHost = groups.find((group) => group.members.length === 2);
    assert.ok(multiHost);
    assert.equal(multiHost.comparisons.length, 1);

    const isolated = groups.filter((group) => group.members.length === 1);
    assert.equal(isolated.length, 3);
    assert.equal(isolated.every((group) => group.comparisons.length === 0), true);
});
