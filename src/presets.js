function resolveOutputPresets(output) {
    const preset = output.preset;
    if (!preset) {
        return Object.assign({}, output);
    }

    const resolved = Object.assign({}, getPresetDefaults(preset), output);
    delete resolved.preset;
    return resolved;
}

function getPresetDefaults(preset) {
    switch (preset) {
        case 'project-codex-stub':
            return {
                target: 'codex',
                scope: 'project',
                guide_buckets: ['shared', 'codex'],
                generated_path: './generated/project/codex/AGENTS.generated.md',
                apply_path: '../AGENTS.md',
                apply_mode: 'stub',
                enabled: true
            };
        case 'project-claude-stub':
            return {
                target: 'claude',
                scope: 'project',
                guide_buckets: ['shared', 'claude'],
                generated_path: './generated/project/claude/CLAUDE.generated.md',
                apply_path: '../CLAUDE.md',
                apply_mode: 'stub',
                enabled: true
            };
        default:
            return Object.assign({ invalid_preset: preset });
    }
}

module.exports = {
    resolveOutputPresets
};
