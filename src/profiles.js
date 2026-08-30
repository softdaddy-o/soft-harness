const os = require('node:os');
const path = require('node:path');

// Codex reads a different file at account scope than it does inside a project:
// a project's own AGENTS.md, but ~/.codex/AGENTS.md at home. Writing the
// account file to ~/AGENTS.md produces a file the host never loads -- verified
// by probing a headless codex session for a rule that exists only there.
const PROFILES = {
    claude: {
        name: 'claude',
        instruction_files: ['CLAUDE.md', '.claude/CLAUDE.md'],
        supports_imports: true,
        skills_dir: '.claude/skills',
        agents_dir: '.claude/agents',
        settings_file: '.claude/settings.json',
        plugins_manifest: '.claude/settings.json'
    },
    codex: {
        name: 'codex',
        instruction_files: ['AGENTS.md'],
        account_instruction_files: ['.codex/AGENTS.md'],
        // Keep this conservative until upstream import semantics are explicitly documented.
        supports_imports: false,
        skills_dir: '.codex/skills',
        agents_dir: '.codex/agents',
        settings_file: '.codex/config.toml',
        plugins_manifest: '.codex/config.toml'
    },
    gemini: {
        name: 'gemini',
        instruction_files: ['GEMINI.md'],
        // Keep this conservative until upstream import semantics are explicitly documented.
        supports_imports: false,
        skills_dir: '.gemini/skills',
        agents_dir: '.gemini/agents',
        settings_file: '.gemini/settings.json',
        plugins_manifest: '.gemini/settings.json'
    }
};

function listProfiles() {
    return Object.keys(PROFILES);
}

function getProfile(name) {
    const profile = PROFILES[name];
    if (!profile) {
        throw new Error(`unknown LLM profile: ${name}`);
    }
    return profile;
}

// Account scope is the user's home directory; every other root is a project.
function isAccountRoot(rootDir) {
    return path.resolve(rootDir) === path.resolve(os.homedir());
}

// The files to generate for this profile at this root. A profile without an
// account-specific list uses the same files at both scopes.
function instructionFilesFor(profile, rootDir) {
    if (isAccountRoot(rootDir) && profile.account_instruction_files) {
        return profile.account_instruction_files;
    }
    return profile.instruction_files;
}

function matchInstructionFile(relativePath) {
    const normalized = relativePath.split('\\').join('/');
    const matches = [];

    for (const [name, profile] of Object.entries(PROFILES)) {
        const known = profile.instruction_files.concat(profile.account_instruction_files || []);
        if (known.includes(normalized)) {
            matches.push(name);
        }
    }

    return matches;
}

module.exports = {
    PROFILES,
    getProfile,
    instructionFilesFor,
    isAccountRoot,
    listProfiles,
    matchInstructionFile
};
