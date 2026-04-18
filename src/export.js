const path = require('node:path');
const { getProfile, listProfiles } = require('./profiles');
const { exists, readUtf8, removePath, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { buildConcatStub, buildImportStub } = require('./stubs');

function buildInstructionExports(rootDir, options) {
    const state = (options && options.state) || { assets: { instructions: [] } };
    const exports = [];

    for (const llm of listProfiles()) {
        const sources = getInstructionSourceEntries(rootDir, llm);
        const shouldExport = sources.some((entry) => entry.present || entry.content.trim().length > 0)
            || state.assets.instructions.some((item) => item.llm === llm);
        if (!shouldExport) {
            continue;
        }

        const profile = getProfile(llm);
        const expected = profile.supports_imports
            ? buildImportStub(sources.map((entry) => entry.source))
            : buildConcatStub(sources.map((entry) => ({
                path: entry.blockPath,
                content: entry.content
            })));

        for (const relativePath of profile.instruction_files) {
            exports.push({
                llm,
                relativePath,
                expected,
                sources: sources.map((entry) => entry.source)
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
            from: entry.sources,
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

function buildInstructionState(rootDir, state) {
    const instructions = [];
    for (const entry of buildInstructionExports(rootDir, { state })) {
        instructions.push({
            llm: entry.llm,
            sources: getInstructionSourceEntries(rootDir, entry.llm).map((source) => source.source),
            target: entry.relativePath,
            source_hash: getCurrentSourceHash(rootDir, entry.llm),
            target_hash: hashString(entry.expected)
        });
    }
    return instructions;
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
    buildInstructionState,
    buildInstructionExports,
    exportInstructions,
    getCurrentSourceHash
};

function getCurrentSourceHash(rootDir, llm) {
    const content = getInstructionSourceEntries(rootDir, llm)
        .map((entry) => `${entry.source}\n${entry.content}`)
        .join('\n\0\n');
    return hashString(content);
}

function getInstructionSourceEntries(rootDir, llm) {
    const sources = [
        { source: '.harness/HARNESS.md', blockPath: 'HARNESS.md' },
        { source: '.harness/memory/shared.md', blockPath: 'memory/shared.md' },
        { source: `.harness/llm/${llm}.md`, blockPath: `llm/${llm}.md` },
        { source: `.harness/memory/llm/${llm}.md`, blockPath: `memory/llm/${llm}.md` }
    ];

    return sources.map((entry) => {
        const absolutePath = path.join(rootDir, entry.source);
        const present = exists(absolutePath);
        return {
            ...entry,
            content: present ? readUtf8(absolutePath) : '',
            present
        };
    });
}
