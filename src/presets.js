const PRESETS = {
    'project-claude': {
        target: 'claude',
        scope: 'project',
        content_type: 'guide-bundle',
        guide_buckets: ['shared', 'claude'],
        apply_path: '../CLAUDE.md',
        enabled: true
    },
    'project-codex': {
        target: 'codex',
        scope: 'project',
        content_type: 'guide-bundle',
        guide_buckets: ['shared', 'codex'],
        apply_path: '../AGENTS.md',
        enabled: true
    },
    'account-claude': {
        target: 'claude',
        scope: 'account',
        content_type: 'guide-bundle',
        guide_buckets: ['shared', 'claude'],
        apply_path: '{userHome}/.claude/CLAUDE.md',
        enabled: true
    },
    'account-codex': {
        target: 'codex',
        scope: 'account',
        content_type: 'guide-bundle',
        guide_buckets: ['shared', 'codex'],
        apply_path: '{userHome}/AGENTS.md',
        enabled: true
    },
    'project-mcp': {
        target: 'both',
        scope: 'project',
        content_type: 'mcp-json',
        apply_path: '../.mcp.json',
        enabled: true
    }
};

const LEGACY_STUB_PRESETS = {
    'project-claude-stub': 'project-claude',
    'project-codex-stub': 'project-codex',
    'account-claude-stub': 'account-claude',
    'account-codex-stub': 'account-codex'
};

function resolveOutputPresets(output) {
    const preset = output.preset;
    if (!preset) {
        return Object.assign({}, output);
    }

    let presetName = preset;
    let legacyStub = false;

    if (LEGACY_STUB_PRESETS[preset]) {
        presetName = LEGACY_STUB_PRESETS[preset];
        legacyStub = true;
    }

    const defaults = PRESETS[presetName];
    if (!defaults) {
        return Object.assign({}, output, { invalid_preset: preset });
    }

    const resolved = Object.assign({}, defaults, output);
    delete resolved.preset;
    if (legacyStub) {
        resolved._legacy_stub = true;
    }
    return resolved;
}

module.exports = {
    LEGACY_STUB_PRESETS,
    resolveOutputPresets
};
