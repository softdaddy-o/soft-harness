const path = require('node:path');
const { getProfile, listProfiles } = require('./profiles');
const { exists, readUtf8, removePath, writeUtf8 } = require('./fs-util');
const { buildConcatStub, buildImportStub } = require('./stubs');

function buildInstructionExports(rootDir, options) {
    const state = (options && options.state) || { assets: { instructions: [] } };
    const exports = [];
    const harnessPath = path.join(rootDir, '.harness', 'HARNESS.md');
    const commonContent = exists(harnessPath) ? readUtf8(harnessPath) : '';

    for (const llm of listProfiles()) {
        const llmSource = path.join(rootDir, '.harness', 'llm', `${llm}.md`);
        const shouldExport = exists(llmSource) || state.assets.instructions.some((item) => item.llm === llm);
        if (!shouldExport) {
            continue;
        }

        const profile = getProfile(llm);
        const llmContent = exists(llmSource) ? readUtf8(llmSource) : '';
        const expected = profile.supports_imports
            ? buildImportStub(llm)
            : buildConcatStub(llm, commonContent, llmContent);

        for (const relativePath of profile.instruction_files) {
            exports.push({
                llm,
                relativePath,
                expected
            });
        }
    }

    return exports;
}

function exportInstructions(rootDir, options) {
    const exports = buildInstructionExports(rootDir, options);
    const written = [];
    const routes = [];

    for (const entry of exports) {
        const absolutePath = path.join(rootDir, entry.relativePath);
        const current = exists(absolutePath) ? readUtf8(absolutePath) : null;
        if (current === entry.expected) {
            continue;
        }

        written.push({
            llm: entry.llm,
            path: entry.relativePath
        });
        routes.push({
            action: 'export-instruction',
            llm: entry.llm,
            from: [`.harness/HARNESS.md`, `.harness/llm/${entry.llm}.md`],
            to: entry.relativePath
        });

        if (options && options.dryRun) {
            continue;
        }

        writeUtf8(absolutePath, entry.expected);
    }

    if (!options || !options.dryRun) {
        pruneStaleTargets(rootDir, exports, options);
    }

    return {
        exported: written,
        plan: exports,
        routes
    };
}

function pruneStaleTargets(rootDir, exports, options) {
    const desired = new Set(exports.map((entry) => entry.relativePath));
    const state = (options && options.state) || { assets: { instructions: [] } };

    for (const entry of state.assets.instructions) {
        if (desired.has(entry.target)) {
            continue;
        }
        removePath(path.join(rootDir, entry.target));
    }
}

module.exports = {
    buildInstructionExports,
    exportInstructions
};
