const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPrompt, parsePromptArgs } = require('../src/llm-prompt');

test('prompt: parsePromptArgs validates analyze mode and account/no-web flags', () => {
    assert.deepEqual(parsePromptArgs(['--analyze', '--account', '--no-web']), {
        analyze: true,
        account: true,
        web: false
    });
    assert.throws(() => parsePromptArgs([]), /requires --analyze/);
});

test('prompt: buildPrompt emits web and no-web variants', () => {
    const webPrompt = buildPrompt({ account: false, web: true });
    assert.match(webPrompt, /soft-harness analyze --category=plugins --json/);
    assert.match(webPrompt, /GitHub releases\/tags/);

    const offlinePrompt = buildPrompt({ account: true, web: false });
    assert.match(offlinePrompt, /soft-harness analyze --account --category=plugins --json/);
    assert.match(offlinePrompt, /Do not guess latest_version from memory/);
});
