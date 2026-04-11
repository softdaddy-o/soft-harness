const path = require('node:path');
const { exists } = require('./fs-util');
const { matchInstructionFile } = require('./profiles');
const { classifyAmbiguous } = require('./prompt');

async function discoverInstructions(rootDir, options) {
    const state = (options && options.state) || { classifications: {} };
    const callback = (options && options.classifyAmbiguous) || classifyAmbiguous;
    const discovered = [];
    const visited = new Set();

    for (const relativePath of getCandidateInstructionFiles()) {
        if (visited.has(relativePath)) {
            continue;
        }
        visited.add(relativePath);

        const absolutePath = path.join(rootDir, relativePath);
        if (!exists(absolutePath)) {
            continue;
        }

        const matches = matchInstructionFile(relativePath);
        if (matches.length === 0) {
            continue;
        }

        let llm = state.classifications[relativePath];
        if (!llm) {
            llm = matches.length === 1 ? matches[0] : await callback(relativePath, matches, options);
        }

        discovered.push({
            llm,
            relativePath,
            absolutePath,
            matches
        });
    }

    return discovered.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function getCandidateInstructionFiles() {
    return [
        'CLAUDE.md',
        '.claude/CLAUDE.md',
        'AGENTS.md',
        'GEMINI.md'
    ];
}

module.exports = {
    discoverInstructions
};
