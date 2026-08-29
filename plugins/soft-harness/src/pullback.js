const path = require('node:path');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');
const { extractImportStubDelta, hasImportStubSources, parseConcatStub } = require('./stubs');

async function pullBackInstructionDrift(rootDir, driftEntries, options) {
    const pulledBack = [];

    for (const entry of driftEntries) {
        if (entry.type !== 'instruction') {
            continue;
        }

        const llmPath = `.harness/llm/${entry.llm}.md`;
        const commonPath = '.harness/HARNESS.md';
        if (hasImportStubSources(entry.expected)) {
            const delta = extractImportStubDelta(entry.actual);
            if (!delta) {
                continue;
            }

            const destination = await chooseInstructionDestination(entry, options);
            const target = destination === 'common' ? commonPath : llmPath;
            if (appendContent(rootDir, target, delta, options)) {
                pulledBack.push({
                    from: entry.relativePath,
                    to: target
                });
            }
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

        if (parsed.outside && appendContent(rootDir, llmPath, parsed.outside, options)) {
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
    const stored = exists(absolutePath) ? readUtf8(absolutePath).trim() : '';
    // Repair a snapshot that an earlier, non-idempotent pull-back already grew
    // into N identical copies, so organize heals the damage instead of only
    // declining to add more.
    const current = collapseRepeatedContent(stored);
    if (current !== stored) {
        writeMaybe(rootDir, relativePath, current, options);
    }
    const addition = delta.trim();
    if (!addition || containsBlock(current, addition)) {
        // The same drift can be pulled back on every run. Appending it again
        // each time is how a snapshot file grows into N identical copies.
        return false;
    }
    const next = [current, addition].filter(Boolean).join('\n\n').trim();
    writeMaybe(rootDir, relativePath, next, options);
    return true;
}

// Collapse a file that is exactly the same block repeated end to end. Only
// byte-identical whole-file repetition is touched: that is a deterministic
// repair, not a judgement about whether two similar sections should merge.
function collapseRepeatedContent(content) {
    const normalized = String(content || '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return normalized;
    }

    const lines = normalized.split('\n');
    // Look for the shortest period the whole file repeats on. A trailing
    // partial repeat counts, because an interrupted append leaves one.
    //
    // MIN_PERIOD_LINES exists because short periodicity occurs in legitimate
    // prose: "one/two/one/two/one" is period 2 and collapsing it would delete
    // real content. A snapshot duplicated by a runaway append is a whole
    // guidance block, not two lines. Being wrong here silently destroys the
    // user's file, so the bar is set well above anything plausible by accident.
    const MIN_PERIOD_LINES = 8;
    const MIN_FULL_REPEATS = 2;

    const maxPeriod = Math.floor(lines.length / MIN_FULL_REPEATS);
    for (let period = MIN_PERIOD_LINES; period <= maxPeriod; period += 1) {
        let periodic = true;
        for (let index = period; index < lines.length; index += 1) {
            if (lines[index] !== lines[index % period]) {
                periodic = false;
                break;
            }
        }
        if (periodic) {
            return lines.slice(0, period).join('\n').trim();
        }
    }

    return normalized;
}

function containsBlock(haystack, needle) {
    if (!haystack || !needle) {
        return false;
    }
    const normalize = (value) => value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
    return normalize(haystack).includes(normalize(needle));
}

function writeMaybe(rootDir, relativePath, content, options) {
    if (options && options.dryRun) {
        return;
    }
    writeUtf8(path.join(rootDir, relativePath), content);
}

module.exports = {
    collapseRepeatedContent,
    pullBackInstructionDrift
};
