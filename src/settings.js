const path = require('node:path');
const YAML = require('yaml');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');
const { hashString } = require('./hash');
const { getProfile, listProfiles } = require('./profiles');

function loadHarnessSettings(rootDir, relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    if (!exists(absolutePath)) {
        return {
            version: 1,
            mcp_servers: {},
            mcp_server_overrides: {}
        };
    }

    const parsed = YAML.parse(readUtf8(absolutePath)) || {};
    return {
        version: parsed.version || 1,
        mcp_servers: normalizeHarnessServers(parsed.mcp_servers || {}),
        mcp_server_overrides: normalizeHarnessOverrides(parsed.mcp_server_overrides || {})
    };
}

function mergeHarnessSettings(rootDir, llm) {
    const portable = loadHarnessSettings(rootDir, path.join('.harness', 'settings', 'portable.yaml'));
    const specific = loadHarnessSettings(rootDir, path.join('.harness', 'settings', 'llm', `${llm}.yaml`));
    const merged = {};
    const overrides = {};

    for (const source of [portable.mcp_servers, specific.mcp_servers]) {
        for (const [name, value] of Object.entries(source)) {
            const normalized = normalizeHarnessServer(value, llm);
            if (!normalized) {
                continue;
            }
            merged[name] = normalized;
        }
    }

    for (const source of [portable.mcp_server_overrides, specific.mcp_server_overrides]) {
        for (const [name, value] of Object.entries(source)) {
            const normalized = normalizeHarnessOverride(value, llm);
            if (!normalized) {
                continue;
            }
            overrides[name] = normalized;
        }
    }

    return {
        version: 1,
        mcp_servers: merged,
        mcp_server_overrides: overrides
    };
}

function exportSettings(rootDir, options) {
    const exported = [];
    const routes = [];

    for (const llm of listProfiles()) {
        const profile = getProfile(llm);
        if (!profile.settings_file) {
            continue;
        }
        if (!hasHarnessSettings(rootDir, llm)) {
            continue;
        }

        const merged = mergeHarnessSettings(rootDir, llm);
        if (Object.keys(merged.mcp_servers).length === 0
            && Object.keys(merged.mcp_server_overrides).length === 0
            && !exists(path.join(rootDir, profile.settings_file))) {
            continue;
        }

        const nextContent = renderHostSettings(rootDir, llm, merged);
        const absolutePath = path.join(rootDir, profile.settings_file);
        const current = exists(absolutePath) ? readUtf8(absolutePath) : null;
        if (current === nextContent) {
            continue;
        }

        exported.push({
            llm,
            path: profile.settings_file
        });
        routes.push({
            action: 'export-settings',
            llm,
            from: [
                '.harness/settings/portable.yaml',
                `.harness/settings/llm/${llm}.yaml`
            ],
            to: profile.settings_file
        });

        if (options && options.dryRun) {
            continue;
        }

        writeUtf8(absolutePath, nextContent);
    }

    return {
        exported,
        routes
    };
}

function buildSettingsState(rootDir) {
    const settings = [];
    for (const llm of listProfiles()) {
        const profile = getProfile(llm);
        if (!profile.settings_file || !hasHarnessSettings(rootDir, llm)) {
            continue;
        }

        const content = renderHostSettings(rootDir, llm, mergeHarnessSettings(rootDir, llm));
        settings.push({
            llm,
            target: profile.settings_file,
            managed_subtree: profile.settings_file.endsWith('.toml') ? 'mcp_servers' : 'mcpServers',
            hash: hashString(content)
        });
    }
    return settings;
}

function renderHostSettings(rootDir, llm, merged) {
    const profile = getProfile(llm);
    const absolutePath = path.join(rootDir, profile.settings_file);
    const current = exists(absolutePath) ? readUtf8(absolutePath) : '';
    if (profile.settings_file.endsWith('.toml')) {
        return renderTomlSettings(current, merged);
    }
    return renderJsonSettings(current, merged);
}

function renderJsonSettings(currentContent, merged) {
    let parsed = {};
    if (String(currentContent || '').trim()) {
        try {
            parsed = JSON.parse(currentContent);
        } catch (error) {
            parsed = {};
        }
    }

    parsed.mcpServers = Object.fromEntries(Object.entries(merged.mcp_servers).map(([name, value]) => [
        name,
        {
            transport: value.transport,
            command: value.command,
            args: value.args,
            cwd: value.cwd,
            env_passthrough: value.env_passthrough,
            enabled: value.enabled
        }
    ]));

    return `${JSON.stringify(parsed, null, 2)}\n`;
}

function renderTomlSettings(currentContent, merged) {
    const preserved = stripManagedTomlSubtree(currentContent);
    const blocks = [];
    const overrides = { ...(merged.mcp_server_overrides || {}) };
    for (const [name, value] of Object.entries(merged.mcp_servers)) {
        const override = overrides[name];
        const enabled = override && override.scope === 'project' ? override.enabled : value.enabled;
        delete overrides[name];
        blocks.push(`[mcp_servers.${name}]`);
        blocks.push(`transport = ${renderTomlScalar(value.transport)}`);
        blocks.push(`command = ${renderTomlScalar(value.command)}`);
        blocks.push(`args = ${renderTomlArray(value.args)}`);
        if (value.cwd) {
            blocks.push(`cwd = ${renderTomlScalar(value.cwd)}`);
        }
        if (value.env_passthrough.length > 0) {
            blocks.push(`env_passthrough = ${renderTomlArray(value.env_passthrough)}`);
        }
        if (enabled !== true) {
            blocks.push(`enabled = ${enabled ? 'true' : 'false'}`);
        }
        blocks.push('');
    }
    for (const [name, value] of Object.entries(overrides)) {
        if (value.scope !== 'project') {
            continue;
        }
        blocks.push(`[mcp_servers.${name}]`);
        blocks.push(`enabled = ${value.enabled ? 'true' : 'false'}`);
        blocks.push('');
    }

    const sections = [];
    const trimmed = preserved.trim();
    if (trimmed) {
        sections.push(trimmed);
    }
    const renderedBlocks = blocks.join('\n').trim();
    if (renderedBlocks) {
        sections.push(renderedBlocks);
    }
    return `${sections.join('\n\n').trim()}\n`;
}

function stripManagedTomlSubtree(content) {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const kept = [];
    let skip = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\[mcp_servers\.[^\]]+\]$/u.test(trimmed)) {
            skip = true;
            continue;
        }
        if (/^\[.+\]$/u.test(trimmed)) {
            skip = false;
        }
        if (!skip) {
            kept.push(line);
        }
    }

    return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

function normalizeHarnessServers(servers) {
    const normalized = {};
    for (const [name, value] of Object.entries(servers || {})) {
        normalized[name] = normalizeHarnessServer(value, null);
    }
    return normalized;
}

function normalizeHarnessOverrides(overrides) {
    const normalized = {};
    for (const [name, value] of Object.entries(overrides || {})) {
        const override = normalizeHarnessOverride(value, null);
        if (!override) {
            continue;
        }
        normalized[name] = override;
    }
    return normalized;
}

function normalizeHarnessServer(value, llm) {
    const enabledFor = Array.isArray(value && value.enabled_for) ? value.enabled_for.slice() : [];
    if (llm && enabledFor.length > 0 && !enabledFor.includes(llm)) {
        return null;
    }

    return {
        transport: (value && value.transport) || 'stdio',
        command: (value && value.command) || '',
        args: Array.isArray(value && value.args) ? value.args.map(String) : [],
        cwd: value && value.cwd ? String(value.cwd) : '',
        env_passthrough: Array.isArray(value && value.env_passthrough)
            ? value.env_passthrough.map(String)
            : [],
        enabled: typeof (value && value.enabled) === 'boolean' ? value.enabled : true,
        enabled_for: enabledFor
    };
}

function normalizeHarnessOverride(value, llm) {
    if (llm && llm !== 'codex') {
        return null;
    }
    const enabledFor = Array.isArray(value && value.enabled_for) ? value.enabled_for.slice() : [];
    if (llm && enabledFor.length > 0 && !enabledFor.includes(llm)) {
        return null;
    }
    if (typeof (value && value.enabled) !== 'boolean') {
        return null;
    }

    return {
        scope: value && value.scope ? String(value.scope) : 'project',
        enabled: value.enabled,
        enabled_for: enabledFor
    };
}

function renderTomlArray(values) {
    return `[${values.map((value) => renderTomlScalar(value)).join(', ')}]`;
}

function renderTomlScalar(value) {
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return JSON.stringify(String(value || ''));
}

function hasHarnessSettings(rootDir, llm) {
    return exists(path.join(rootDir, '.harness', 'settings', 'portable.yaml'))
        || exists(path.join(rootDir, '.harness', 'settings', 'llm', `${llm}.yaml`));
}

module.exports = {
    buildSettingsState,
    exportSettings,
    loadHarnessSettings,
    mergeHarnessSettings
};
