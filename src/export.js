const path = require('node:path');
const { getProfile, listProfiles } = require('./profiles');
const { exists, readUtf8, removePath, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { buildConcatStub, buildImportStub } = require('./stubs');
const { areInstructionsExternal, excludedInstructionLlms } = require('./harness-config');

function buildInstructionExports(rootDir, options) {
    // Every instruction path funnels through here — export, drift detection,
    // pull-back and state all derive from this list — so one guard covers them
    // all. A project whose instruction files are owned by another convention
    // declares that in .harness/config.json.
    if (areInstructionsExternal(rootDir)) {
        return [];
    }

    const state = (options && options.state) || { assets: { instructions: [] } };
    const excluded = excludedInstructionLlms(rootDir);
    const exports = [];

    for (const llm of listProfiles()) {
        if (excluded.has(llm)) {
            continue;
        }
        const sources = getInstructionSourceEntries(rootDir, llm);
        const shouldExport = sources.some((entry) => entry.present || entry.content.trim().length > 0)
            || state.assets.instructions.some((item) => item.llm === llm);
        if (!shouldExport) {
            continue;
        }

        const profile = getProfile(llm);

        for (const relativePath of profile.instruction_files) {
            // Import stubs are per-file: a relative import resolves against the
            // instruction file's own directory, so a file nested below the root
            // needs its own prefix. Concat stubs inline content and are
            // position-independent.
            const expected = profile.supports_imports
                ? buildImportStub(sources.map((entry) => entry.source), relativePath)
                : buildConcatStub(sources.map((entry) => ({
                    path: entry.blockPath,
                    content: entry.content
                })));

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
    // Opting out means "these files are not mine", not "delete them". Without
    // this guard the empty export list would read every previously managed
    // target as stale and remove the project's own instruction files.
    if (areInstructionsExternal(rootDir)) {
        return;
    }

    const desired = new Set(exports.map((entry) => entry.relativePath));
    const excluded = excludedInstructionLlms(rootDir);
    const state = (options && options.state) || { assets: { instructions: [] } };

    for (const entry of state.assets.instructions) {
        if (desired.has(entry.target) || excluded.has(entry.llm)) {
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
