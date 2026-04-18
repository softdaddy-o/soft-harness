const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConcatStub, buildImportStub, extractImportStubDelta, parseConcatStub } = require('../src/stubs');

test('stubs: import stub references harness files', () => {
    const stub = buildImportStub([
        '.harness/HARNESS.md',
        '.harness/memory/shared.md',
        '.harness/llm/claude.md',
        '.harness/memory/llm/claude.md'
    ]);
    assert.match(stub, /@\.harness\/HARNESS\.md/);
    assert.match(stub, /@\.harness\/memory\/shared\.md/);
    assert.match(stub, /@\.harness\/llm\/claude\.md/);
    assert.match(stub, /@\.harness\/memory\/llm\/claude\.md/);
    assert.match(stub, /Regenerate: soft-harness organize/);
});

test('stubs: concat stub parses block contents and outside edits', () => {
    const stub = buildConcatStub([
        { path: 'HARNESS.md', content: '# Common' },
        { path: 'memory/shared.md', content: '## Memory' },
        { path: 'llm/codex.md', content: '# Specific' }
    ]);
    const mutated = `${stub}\nmanual tail\n`;
    const parsed = parseConcatStub(mutated);
    assert.equal(parsed.blocks.length, 3);
    assert.match(parsed.outside, /manual tail/);
});

test('stubs: import stub delta strips managed lines', () => {
    const delta = extractImportStubDelta(`${buildImportStub('claude')}custom`);
    assert.equal(delta, 'custom');
});
