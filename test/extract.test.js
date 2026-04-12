const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInstructionBuckets } = require('../src/extract');
const { loadFresh } = require('./helpers');

test('extract: identical sections become common content', () => {
    const result = extractInstructionBuckets([
        {
            llm: 'claude',
            content: '## Code Style\n- single quotes\n\n## Claude\nalpha'
        },
        {
            llm: 'codex',
            content: '## Code Style\n- single quotes\n\n## Codex\nbeta'
        }
    ]);

    assert.match(result.commonContent, /## Code Style/);
    assert.doesNotMatch(result.llmContents.claude, /## Code Style/);
    assert.match(result.llmContents.claude, /## Claude/);
    assert.match(result.llmContents.codex, /## Codex/);
});

test('extract: single file keeps all content LLM-specific', () => {
    const result = extractInstructionBuckets([{
        llm: 'claude',
        content: '## Only\nhello'
    }]);

    assert.equal(result.commonContent, '');
    assert.match(result.llmContents.claude, /## Only/);
});

test('extract: near-match sections are flagged as maybe common', () => {
    const result = extractInstructionBuckets([
        {
            llm: 'claude',
            content: '## Code Style\n- single quotes\n- 4 spaces'
        },
        {
            llm: 'codex',
            content: '## Code Style\n- single quotes\n- 4-space indentation'
        }
    ]);

    assert.ok(result.maybeSections.length >= 1);
});

test('extract: empty and one-character bodies use stable similarity math', () => {
    const empty = extractInstructionBuckets([
        {
            llm: 'claude',
            content: '## Empty\n'
        },
        {
            llm: 'codex',
            content: '## Empty\n'
        }
    ]);
    assert.match(empty.commonContent, /## Empty/);

    const short = extractInstructionBuckets([
        {
            llm: 'claude',
            content: '## Short\na'
        },
        {
            llm: 'codex',
            content: '## Short\na extra'
        }
    ]);
    assert.equal(Array.isArray(short.maybeSections), true);
});

test('extract: empty-body similarity branch remains stable under hash divergence', () => {
    const hash = require('../src/hash');
    const originalHashString = hash.hashString;
    let calls = 0;
    hash.hashString = () => `forced-${calls += 1}`;

    try {
        const { extractInstructionBuckets: extractFresh } = loadFresh('../src/extract');
        const result = extractFresh([
            {
                llm: 'claude',
                content: '## Empty\n'
            },
            {
                llm: 'codex',
                content: '## Empty\n'
            }
        ], { maybeThreshold: 1 });
        assert.equal(Array.isArray(result.maybeSections), true);
    } finally {
        hash.hashString = originalHashString;
        delete require.cache[require.resolve('../src/extract')];
    }
});
