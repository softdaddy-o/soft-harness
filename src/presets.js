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
        case 'account-claude-stub':
            return {
                target: 'claude',
                scope: 'account',
                guide_buckets: ['shared', 'claude'],
                generated_path: './generated/account/claude/CLAUDE.generated.md',
                apply_path: '{userHome}/.claude/CLAUDE.md',
                apply_mode: 'stub',
                enabled: true
            };
        case 'account-codex-stub':
            return {
                target: 'codex',
                scope: 'account',
                guide_buckets: ['shared', 'codex'],
                generated_path: './generated/account/codex/AGENTS.generated.md',
                apply_path: '{userHome}/.agents/AGENTS.md',
                apply_mode: 'stub',
                enabled: true
            };
        case 'project-mcp':
            return {
                target: 'both',
                scope: 'project',
                content_type: 'mcp-json',
                generated_path: './generated/project/shared/mcp.generated.json',
                apply_path: '../.mcp.json',
                apply_mode: 'copy',
                enabled: true
            };
        default:
            return Object.assign({ invalid_preset: preset });
    }
}

module.exports = {
    resolveOutputPresets
};
