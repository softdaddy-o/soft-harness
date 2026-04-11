const path = require('node:path');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');
const { extractInstructionBuckets } = require('./extract');

async function importInstructions(rootDir, discovered, options) {
    const harnessDir = path.join(rootDir, '.harness');
    const llmDir = path.join(harnessDir, 'llm');
    ensureDir(llmDir);

    const harnessPath = path.join(harnessDir, 'HARNESS.md');
    const imported = [];
    const writes = [];

    if (discovered.length === 0) {
        if (!exists(harnessPath)) {
            writes.push({ path: '.harness/HARNESS.md', content: '' });
            if (!options || !options.dryRun) {
                writeUtf8(harnessPath, '');
            }
        }
        return {
            imported,
            writes
        };
    }

    const hasExistingHarness = exists(harnessPath) || discovered.some((entry) => exists(path.join(llmDir, `${entry.llm}.md`)));
    if (!hasExistingHarness) {
        const buckets = extractInstructionBuckets(discovered.map((entry) => ({
            llm: entry.llm,
            content: readUtf8(entry.absolutePath)
        })));
        writeMaybe(rootDir, '.harness/HARNESS.md', buckets.commonContent, writes, options);
        for (const entry of discovered) {
            writeMaybe(rootDir, `.harness/llm/${entry.llm}.md`, buckets.llmContents[entry.llm] || '', writes, options);
            imported.push({
                llm: entry.llm,
                from: entry.relativePath,
                to: `.harness/llm/${entry.llm}.md`
            });
        }
        return {
            imported,
            writes,
            maybeSections: buckets.maybeSections
        };
    }

    if (!exists(harnessPath)) {
        writeMaybe(rootDir, '.harness/HARNESS.md', '', writes, options);
    }

    for (const entry of discovered) {
        const targetPath = `.harness/llm/${entry.llm}.md`;
        if (exists(path.join(rootDir, targetPath))) {
            continue;
        }
        writeMaybe(rootDir, targetPath, readUtf8(entry.absolutePath), writes, options);
        imported.push({
            llm: entry.llm,
            from: entry.relativePath,
            to: targetPath
        });
    }

    return {
        imported,
        writes,
        maybeSections: []
    };
}

function writeMaybe(rootDir, relativePath, content, writes, options) {
    writes.push({
        path: relativePath,
        content
    });
    if (!options || !options.dryRun) {
        writeUtf8(path.join(rootDir, relativePath), content);
    }
}

module.exports = {
    importInstructions
};
