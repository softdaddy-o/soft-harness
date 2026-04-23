const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { runSkillEvals } = require('../src/skill-eval');

test('skill evals: active analyze and organize surfaces pass the virtual PC suite', async () => {
    const result = await runSkillEvals({
        repoRoot: path.join(__dirname, '..'),
        forceGeneratedVirtualPc: true
    });

    assert.equal(result.summary.failed, 0, JSON.stringify(result, null, 2));
    assert.equal(result.summary.passed, result.summary.total);
    assert.ok(result.checks.some((entry) => entry.name === 'analyze-virtual-pc-account'));
    assert.ok(result.checks.some((entry) => entry.name === 'organize-helper-flow'));
});
