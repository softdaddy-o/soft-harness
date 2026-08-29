const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildInstructionExports } = require('../src/export');
const { extractImportStubDelta } = require('../src/stubs');
const { pullBackInstructionDrift, collapseRepeatedContent } = require('../src/pullback');
const { makeProjectTree } = require('./helpers');

function harnessTree(extra) {
    return Object.assign({
        '.harness': {
            'HARNESS.md': '# Shared\n\n- shared rule\n',
            llm: { 'claude.md': '# Claude-Specific Guidance\n\n- claude rule\n' },
            memory: {
                'shared.md': '',
                llm: { 'claude.md': '' }
            }
        }
    }, extra || {});
}

// A nested instruction file (.claude/CLAUDE.md) sits one directory below the
// root that `.harness/` lives in. A host resolves a relative import against the
// importing file's own directory, so a bare `@.harness/...` there points at
// <root>/.claude/.harness/... which does not exist.
test('import stub for a nested instruction file resolves to the real .harness directory', () => {
    const root = makeProjectTree('soft-harness-nested-import-', harnessTree());
    const exports = buildInstructionExports(root, { state: { assets: { instructions: [] } } });

    const nested = exports.find((entry) => entry.relativePath === path.join('.claude', 'CLAUDE.md')
        || entry.relativePath === '.claude/CLAUDE.md');
    assert.ok(nested, 'expected a .claude/CLAUDE.md export for the claude profile');

    const importLines = nested.expected.split('\n').filter((line) => line.startsWith('@'));
    assert.ok(importLines.length > 0, 'expected import lines in the stub');

    const nestedDir = path.dirname(path.join(root, nested.relativePath));
    for (const line of importLines) {
        const target = path.resolve(nestedDir, line.slice(1));
        assert.ok(fs.existsSync(target), `import ${line} resolves to ${target}, which does not exist`);
    }
});

test('root instruction file keeps its bare .harness import prefix', () => {
    const root = makeProjectTree('soft-harness-root-import-', harnessTree());
    const exports = buildInstructionExports(root, { state: { assets: { instructions: [] } } });

    const rootEntry = exports.find((entry) => entry.relativePath === 'CLAUDE.md');
    assert.ok(rootEntry, 'expected a CLAUDE.md export');
    assert.ok(
        rootEntry.expected.includes('@.harness/HARNESS.md'),
        'root stub should keep the bare .harness/ prefix'
    );
});

// Whatever prefix the generator emits, the delta extractor has to recognise it.
// If it does not, the stub's own import lines are treated as user-authored
// content and appended into .harness on every organize run.
test('delta extractor recognises the import lines the generator emits', () => {
    const root = makeProjectTree('soft-harness-delta-', harnessTree());
    const exports = buildInstructionExports(root, { state: { assets: { instructions: [] } } });

    for (const entry of exports.filter((item) => item.llm === 'claude')) {
        assert.equal(
            extractImportStubDelta(entry.expected),
            '',
            `stub for ${entry.relativePath} should extract to an empty delta`
        );
    }
});

// Pull-back appends the delta into .harness. Repeating the same drift must not
// stack another copy of content that is already there.
test('pull-back does not duplicate a delta it has already stored', async () => {
    const root = makeProjectTree('soft-harness-pullback-idem-', harnessTree());
    const llmPath = path.join(root, '.harness', 'llm', 'claude.md');

    const entry = {
        type: 'instruction',
        llm: 'claude',
        relativePath: 'CLAUDE.md',
        expected: '@.harness/HARNESS.md\n',
        actual: '@.harness/HARNESS.md\n\n- an extra hand written rule\n'
    };

    await pullBackInstructionDrift(root, [entry], { routeInstructionDelta: () => 'claude' });
    const afterFirst = fs.readFileSync(llmPath, 'utf8');

    await pullBackInstructionDrift(root, [entry], { routeInstructionDelta: () => 'claude' });
    const afterSecond = fs.readFileSync(llmPath, 'utf8');

    const occurrences = afterSecond.split('- an extra hand written rule').length - 1;
    assert.equal(occurrences, 1, 'delta should be stored exactly once');
    assert.equal(afterSecond, afterFirst, 'second pull-back of the same drift should be a no-op');
});

// The regression guard for the duplication this fixes: repeated organize runs
// must not make the snapshot grow.
test('repeated syncs do not grow the harness snapshot', async () => {
    const { runSync } = require('../src/sync');
    const root = makeProjectTree('soft-harness-no-growth-', harnessTree());
    const llmPath = path.join(root, '.harness', 'llm', 'claude.md');

    await runSync(root, {}, {});
    const first = fs.readFileSync(llmPath, 'utf8');

    await runSync(root, {}, {});
    await runSync(root, {}, {});
    const third = fs.readFileSync(llmPath, 'utf8');

    const copies = third.split('# Claude-Specific Guidance').length - 1;
    assert.equal(copies, 1, 'host-specific snapshot should hold exactly one copy of its content');
    assert.ok(third.length <= first.length, 'snapshot must not grow across repeated syncs');
});

// Repairing an already-duplicated snapshot, without destroying content that is
// merely periodic.
test('pull-back collapses a duplicated snapshot but spares periodic prose', async () => {
    const block = ['# Claude-Specific Guidance', '']
        .concat(Array.from({ length: 8 }, (_, index) => `- rule ${index}`))
        .join('\n');

    assert.equal(collapseRepeatedContent([block, block, block].join('\n')), block);
    assert.equal(collapseRepeatedContent(block), block);
    assert.equal(collapseRepeatedContent(''), '');

    // A trailing partial repeat, which an interrupted append leaves behind.
    assert.equal(
        collapseRepeatedContent([block, block, '# Claude-Specific Guidance'].join('\n')),
        block
    );

    // Short periodicity occurs in real prose. Collapsing it would delete
    // content, so it is deliberately left alone.
    const shortPeriodic = ['one', 'two', 'one', 'two'].join('\n');
    assert.equal(collapseRepeatedContent(shortPeriodic), shortPeriodic);

    const mixed = ['# A', '', '- one', '', '# B', '', '- two'].join('\n');
    assert.equal(collapseRepeatedContent(mixed), mixed);

    // And it heals through the real pull-back path.
    const root = makeProjectTree('soft-harness-collapse-', harnessTree());
    const llmPath = path.join(root, '.harness', 'llm', 'claude.md');
    fs.writeFileSync(llmPath, [block, block, block, block].join('\n'), 'utf8');

    await pullBackInstructionDrift(root, [{
        type: 'instruction',
        llm: 'claude',
        relativePath: 'CLAUDE.md',
        expected: '@.harness/HARNESS.md\n',
        actual: '@.harness/HARNESS.md\n\n- a fresh rule\n'
    }], { routeInstructionDelta: () => 'claude' });

    const healed = fs.readFileSync(llmPath, 'utf8');
    assert.equal(healed.split('# Claude-Specific Guidance').length - 1, 1, 'duplicates should be collapsed');
    assert.ok(healed.includes('- a fresh rule'), 'the new delta should still be stored');
});
