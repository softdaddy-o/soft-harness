const path = require('node:path');
const { exists, readUtf8 } = require('./fs-util');

// Optional `.harness/config.json`. Absent means "every default applies", which
// is the state almost every project is in.
//
// The one key today is `instructions`. A project that owns its instruction
// files by another convention sets `"instructions": "external"`, and
// soft-harness then neither generates them, nor pulls them back, nor reports
// them as drift, while still managing skills, agents and settings.
//
// This exists because emptying `.sync-state.json` does not opt out: the
// exporter re-adopts a target whenever the source fragments still exist, so a
// decision recorded only in state silently evaporated on the next run.
function readHarnessConfig(rootDir) {
    const configPath = path.join(rootDir, '.harness', 'config.json');
    if (!exists(configPath)) {
        return {};
    }

    const raw = readUtf8(configPath);
    try {
        return JSON.parse(raw) || {};
    } catch (error) {
        // Failing loudly is the point. A config that is silently ignored is how
        // the previous opt-out attempt disappeared without anyone noticing.
        throw new Error(`.harness/config.json is not valid JSON: ${error.message}`);
    }
}

function areInstructionsExternal(rootDir) {
    const value = readHarnessConfig(rootDir).instructions;
    return String(value == null ? '' : value).trim().toLowerCase() === 'external';
}

// `{"instructions": {"exclude": ["gemini"]}}` keeps generation on for the other
// hosts and drops one the project does not use. Deleting the file alone does
// not hold: the exporter re-adopts a target whenever the shared fragments
// exist, so the exclusion has to be declared rather than performed.
function excludedInstructionLlms(rootDir) {
    const value = readHarnessConfig(rootDir).instructions;
    if (!value || typeof value !== 'object' || !Array.isArray(value.exclude)) {
        return new Set();
    }
    return new Set(value.exclude.map((llm) => String(llm).trim().toLowerCase()).filter(Boolean));
}

module.exports = {
    areInstructionsExternal,
    excludedInstructionLlms,
    readHarnessConfig
};
