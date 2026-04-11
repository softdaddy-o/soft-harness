const test = require('node:test');
const assert = require('node:assert/strict');
const { buildConcatStub, buildImportStub, extractImportStubDelta, parseConcatStub } = require('../src/stubs');

test('stubs: import stub references harness files', () => {
    const stub = buildImportStub('claude');
    assert.match(stub, /@\.harness\/HARNESS\.md/);
    assert.match(stub, /@\.harness\/llm\/claude\.md/);
});

test('stubs: concat stub parses block contents and outside edits', () => {
    const stub = buildConcatStub('codex', '# Common', '# Specific');
    const mutated = `${stub}\nmanual tail\n`;
    const parsed = parseConcatStub(mutated);
    assert.equal(parsed.blocks.length, 2);
    assert.match(parsed.outside, /manual tail/);
});

test('stubs: import stub delta strips managed lines', () => {
    const delta = extractImportStubDelta(`${buildImportStub('claude')}custom`);
    assert.equal(delta, 'custom');
});
