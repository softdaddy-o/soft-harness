const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');
const { extractImportStubDelta, parseConcatStub } = require('./stubs');

async function pullBackInstructionDrift(rootDir, driftEntries, options) {
    const pulledBack = [];

    for (const entry of driftEntries) {
        if (entry.type !== 'instruction') {
            continue;
        }

        const llmPath = `.harness/llm/${entry.llm}.md`;
        const commonPath = '.harness/HARNESS.md';
        if (entry.expected.includes('@.harness/')) {
            const delta = extractImportStubDelta(entry.actual);
            if (!delta) {
                continue;
            }

            const destination = await chooseInstructionDestination(entry, options);
            appendContent(rootDir, destination === 'common' ? commonPath : llmPath, delta, options);
            pulledBack.push({
                from: entry.relativePath,
                to: destination === 'common' ? commonPath : llmPath
            });
            continue;
        }

        const parsed = parseConcatStub(entry.actual);
        for (const block of parsed.blocks) {
            const relativeTarget = `.harness/${block.path}`;
            const current = exists(path.join(rootDir, relativeTarget)) ? readUtf8(path.join(rootDir, relativeTarget)) : '';
            if (current === block.content) {
                continue;
            }
            writeMaybe(rootDir, relativeTarget, block.content, options);
            pulledBack.push({
                from: entry.relativePath,
                to: relativeTarget
            });
        }

        if (parsed.outside) {
            appendContent(rootDir, llmPath, parsed.outside, options);
            pulledBack.push({
                from: entry.relativePath,
                to: llmPath
            });
        }
    }

    return pulledBack;
}

async function chooseInstructionDestination(entry, options) {
    if (options && typeof options.routeInstructionDelta === 'function') {
        return options.routeInstructionDelta(entry);
    }
    if (options && options.manualReview && typeof options.select === 'function') {
        return options.select(`Route edits from ${entry.relativePath}`, [
            { label: 'common', value: 'common' },
            { label: entry.llm, value: entry.llm }
        ]);
    }
    return entry.llm;
}

function appendContent(rootDir, relativePath, delta, options) {
    const absolutePath = path.join(rootDir, relativePath);
    const current = exists(absolutePath) ? readUtf8(absolutePath).trim() : '';
    const next = [current, delta.trim()].filter(Boolean).join('\n\n').trim();
    writeMaybe(rootDir, relativePath, next, options);
}

function writeMaybe(rootDir, relativePath, content, options) {
    if (options && options.dryRun) {
        return;
    }
    writeUtf8(path.join(rootDir, relativePath), content);
}

module.exports = {
    pullBackInstructionDrift
};
