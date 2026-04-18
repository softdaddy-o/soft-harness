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

function matchInstructionFile(relativePath) {
    const normalized = relativePath.split('\\').join('/');
    const matches = [];

    for (const [name, profile] of Object.entries(PROFILES)) {
        if (profile.instruction_files.includes(normalized)) {
            matches.push(name);
        }
    }

    return matches;
}

module.exports = {
    PROFILES,
    getProfile,
    listProfiles,
    matchInstructionFile
};
