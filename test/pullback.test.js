const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exists, readUtf8 } = require('../src/fs-util');
const { pullBackInstructionDrift } = require('../src/pullback');
const { makeProjectTree, makeTempDir } = require('./helpers');

test('pullback: import stubs can route edits into common content', async () => {
    const root = makeProjectTree('soft-harness-pullback-common-', {
        '.harness': {
            'HARNESS.md': 'existing common',
            llm: {
                'claude.md': 'existing claude'
            }
        },
        'CLAUDE.md': [
            '<!-- Managed by soft-harness: import-stub -->',
            '<!-- source: @.harness/llm/claude.md -->',
            'local delta',
            ''
        ].join('\n')
    });

    const pulledBack = await pullBackInstructionDrift(root, [{
        type: 'instruction',
        llm: 'claude',
        relativePath: 'CLAUDE.md',
        expected: '@.harness/llm/claude.md',
        actual: readUtf8(path.join(root, 'CLAUDE.md'))
    }], {
        routeInstructionDelta() {
            return 'common';
        }
    });

    assert.deepEqual(pulledBack, [{ from: 'CLAUDE.md', to: '.harness/HARNESS.md' }]);
    assert.match(readUtf8(path.join(root, '.harness', 'HARNESS.md')), /local delta/);
});

test('pullback: manual review can route import stubs to llm-specific content', async () => {
    const root = makeProjectTree('soft-harness-pullback-llm-', {
        '.harness': {
            'HARNESS.md': '',
            llm: {
                'claude.md': 'existing claude'
            }
        },
        'CLAUDE.md': [
            '<!-- Managed by soft-harness: import-stub -->',
            '<!-- source: @.harness/llm/claude.md -->',
            'local delta',
            ''
        ].join('\n')
    });

    const pulledBack = await pullBackInstructionDrift(root, [{
        type: 'instruction',
        llm: 'claude',
        relativePath: 'CLAUDE.md',
        expected: '@.harness/llm/claude.md',
        actual: readUtf8(path.join(root, 'CLAUDE.md'))
    }], {
        manualReview: true,
        select(question, choices) {
            assert.match(question, /Route edits from CLAUDE\.md/);
            assert.equal(choices[1].value, 'claude');
            return 'claude';
        }
    });

    assert.deepEqual(pulledBack, [{ from: 'CLAUDE.md', to: '.harness/llm/claude.md' }]);
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'claude.md')), /local delta/);
});

test('pullback: concat stubs update block files, outside edits, and dry-run skips writes', async () => {
    const root = makeProjectTree('soft-harness-pullback-concat-', {
        '.harness': {
            'HARNESS.md': 'common body',
            llm: {
                'codex.md': 'old codex'
            }
        }
    });
    const actual = [
        '<!-- Managed by soft-harness: concat-stub -->',
        '<!-- Source: .harness/HARNESS.md + .harness/llm/codex.md -->',
        '<!-- Regenerate: soft-harness organize -->',
        '<!-- BEGIN HARNESS.md -->',
        'new common body',
        '<!-- END HARNESS.md -->',
        '<!-- BEGIN llm/codex.md -->',
        'new codex body',
        '<!-- END llm/codex.md -->',
        'manual tail',
        ''
    ].join('\n');

    const pulledBack = await pullBackInstructionDrift(root, [{
        type: 'instruction',
        llm: 'codex',
        relativePath: 'AGENTS.md',
        expected: 'concat',
        actual
    }], {});

    assert.ok(pulledBack.some((entry) => entry.to === '.harness/HARNESS.md'));
    assert.ok(pulledBack.some((entry) => entry.to === '.harness/llm/codex.md'));
    assert.match(readUtf8(path.join(root, '.harness', 'HARNESS.md')), /new common body/);
    assert.match(readUtf8(path.join(root, '.harness', 'llm', 'codex.md')), /manual tail/);

    const dryRoot = makeTempDir('soft-harness-pullback-dry-');
    await pullBackInstructionDrift(dryRoot, [{
        type: 'instruction',
        llm: 'claude',
        relativePath: 'CLAUDE.md',
        expected: '@.harness/llm/claude.md',
        actual: '<!-- Managed by soft-harness: import-stub -->\n<!-- source: @.harness/llm/claude.md -->\ndry delta\n'
    }, {
        type: 'instruction',
        llm: 'claude',
        relativePath: 'IGNORED.md',
        expected: '@.harness/llm/claude.md',
        actual: 'no marker'
    }], { dryRun: true });

    assert.equal(exists(path.join(dryRoot, '.harness', 'llm', 'claude.md')), false);
});

test('pullback: ignores non-instruction entries and import stubs without delta', async () => {
    const root = makeTempDir('soft-harness-pullback-ignore-');
    const pulledBack = await pullBackInstructionDrift(root, [
        { type: 'skill', relativePath: '.claude/skills/foo', actual: 'x', expected: 'y' },
        {
            type: 'instruction',
            llm: 'claude',
            relativePath: 'CLAUDE.md',
            expected: '@.harness/llm/claude.md',
            actual: '<!-- Managed by soft-harness. Do not edit this file directly. -->\n<!-- Source: .harness/HARNESS.md + .harness/llm/claude.md -->\n<!-- Regenerate: soft-harness organize -->\n@.harness/HARNESS.md\n@.harness/llm/claude.md\n'
        }
    ], {});

    assert.deepEqual(pulledBack, []);
});
