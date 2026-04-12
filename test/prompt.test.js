const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { askLine, classifyAmbiguous, confirm, select } = require('../src/prompt');

test('prompt: askLine trims interactive input', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    input.end('  hello world  \n');

    const answer = await askLine('question? ', { input, output });
    assert.equal(answer, 'hello world');
});

test('prompt: confirm accepts yes and no answers', async () => {
    assert.equal(await confirm('Proceed?', { askLine: async () => 'yes' }), true);
    assert.equal(await confirm('Proceed?', { askLine: async () => 'n' }), false);
    assert.equal(await confirm('Proceed?', { confirm: async () => true }), true);
});

test('prompt: select supports numeric, direct, and invalid values', async () => {
    const choices = [
        { label: 'Claude', value: 'claude' },
        { label: 'Codex', value: 'codex' }
    ];

    assert.equal(await select('Choose', choices, { askLine: async () => '2' }), 'codex');
    assert.equal(await select('Choose', choices, { askLine: async () => 'claude' }), 'claude');
    assert.equal(await select('Choose', choices, { select: async () => 'claude' }), 'claude');
    await assert.rejects(() => select('Choose', choices, { askLine: async () => 'bogus' }), /invalid selection/i);
});

test('prompt: classifyAmbiguous returns the only match or delegates to select', async () => {
    assert.equal(await classifyAmbiguous('CLAUDE.md', ['claude'], {}), 'claude');
    const selected = await classifyAmbiguous('AGENTS.md', ['claude', 'codex'], {
        select(question, choices) {
            assert.match(question, /Classify AGENTS\.md/);
            assert.equal(choices.length, 2);
            return 'codex';
        }
    });
    assert.equal(selected, 'codex');
});
