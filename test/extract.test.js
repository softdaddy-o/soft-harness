const test = require('node:test');
const assert = require('node:assert/strict');
const { extractInstructionBuckets } = require('../src/extract');

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
