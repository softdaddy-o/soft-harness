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
    assert.match(webPrompt, /soft-harness analyze --category=skills --json/);
    assert.match(webPrompt, /soft-harness plugins import-origins --input=plugin-origins\.json/);
    assert.match(webPrompt, /soft-harness origins import --input=asset-origins\.json/);
    assert.match(webPrompt, /GitHub releases\/tags/);
    assert.match(webPrompt, /Use your available web search\/browser tools/);
    assert.match(webPrompt, /Search the web for each unresolved or weakly-evidenced plugin, skill, or agent origin/);
    assert.match(webPrompt, /Use `search_hints` from asset entries as the first GitHub\/web search queries/);
    assert.match(webPrompt, /Do not stop at local metadata/);
    assert.match(webPrompt, /Find GitHub repositories and official marketplace pages/);
    assert.match(webPrompt, /expert agents/);
    assert.match(webPrompt, /Run the commands yourself/);
    assert.match(webPrompt, /It is safe before the first snapshot refresh/);
    assert.match(webPrompt, /Do not use legacy `soft-harness sync`/);
    assert.doesNotMatch(webPrompt, /curat/i);

    const offlinePrompt = buildPrompt({ account: true, web: false });
    assert.match(offlinePrompt, /soft-harness analyze --account --category=plugins --json/);
    assert.match(offlinePrompt, /soft-harness analyze --account --category=skills --json/);
    assert.match(offlinePrompt, /soft-harness plugins import-origins --account --input=plugin-origins\.json/);
    assert.match(offlinePrompt, /soft-harness origins import --account --input=asset-origins\.json/);
    assert.match(offlinePrompt, /Do not guess latest_version from memory/);
    assert.doesNotMatch(offlinePrompt, /Use your available web search\/browser tools/);
});
