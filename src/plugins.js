const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { exists, readUtf8 } = require('./fs-util');
const { listProfiles, getProfile } = require('./profiles');
const { hashString } = require('./hash');

function loadPlugins(rootDir) {
    const pluginsPath = path.join(rootDir, '.harness', 'plugins.yaml');
    if (!exists(pluginsPath)) {
        return [];
    }

    const parsed = YAML.parse(readUtf8(pluginsPath)) || {};
    const plugins = parsed.plugins || [];
    validatePlugins(plugins);
    return plugins;
}

function validatePlugins(plugins) {
    if (!Array.isArray(plugins)) {
        throw new Error('plugins.yaml must define a plugins array');
    }

    const knownLlms = new Set(listProfiles());
    for (const plugin of plugins) {
        if (!plugin.name || !plugin.install || !plugin.uninstall) {
            throw new Error('plugins must include name, install, and uninstall');
        }
        if (!Array.isArray(plugin.llms) || plugin.llms.some((llm) => !knownLlms.has(llm))) {
            throw new Error(`plugin ${plugin.name} has invalid llms`);
        }
    }
}

function detectPluginDrift(rootDir, options) {
    const desired = loadPlugins(rootDir);
    const desiredByLlm = new Map();
    for (const plugin of desired) {
        for (const llm of plugin.llms) {
            if (!desiredByLlm.has(llm)) {
                desiredByLlm.set(llm, new Set());
            }
            desiredByLlm.get(llm).add(plugin.name);
        }
    }

    const drift = [];
    for (const llm of listProfiles()) {
        const installed = readInstalledPlugins(rootDir, llm);
        const desiredNames = desiredByLlm.get(llm) || new Set();
        for (const pluginName of installed) {
            if (!desiredNames.has(pluginName)) {
                drift.push({
                    type: 'plugin',
                    llm,
                    name: pluginName,
                    action: 'adopt'
                });
            }
        }
    }

    return drift;
}

function syncPlugins(rootDir, state, options) {
    const desired = loadPlugins(rootDir);
    const previous = new Map((state.plugins || []).map((plugin) => [plugin.name, plugin]));
    const desiredMap = new Map(desired.map((plugin) => [plugin.name, plugin]));
    const actions = [];

    for (const plugin of desired) {
        const installHash = hashString(`${plugin.version || ''}\n${plugin.install}`);
        const prior = previous.get(plugin.name);
        if (!prior || prior.install_hash !== installHash) {
            actions.push(runPluginCommand(rootDir, {
                type: 'install',
                name: plugin.name,
                command: plugin.install
            }, options));
        }
    }

    for (const plugin of previous.values()) {
        if (desiredMap.has(plugin.name)) {
            continue;
        }
        actions.push(runPluginCommand(rootDir, {
            type: 'uninstall',
            name: plugin.name,
            command: plugin.uninstall
        }, {
            ...options,
            dryRun: options && options.noRunUninstalls ? true : options && options.dryRun
        }));
    }

    return {
        actions,
        state: desired.map((plugin) => ({
            name: plugin.name,
            version: plugin.version || null,
            llms: plugin.llms,
            install_hash: hashString(`${plugin.version || ''}\n${plugin.install}`),
            uninstall: plugin.uninstall
        }))
    };
}

function runPluginCommand(rootDir, action, options) {
    const dryRun = options && (options.dryRun
        || (action.type === 'install' && options.noRunInstalls)
        || (action.type === 'uninstall' && options.noRunUninstalls));

    if (dryRun) {
        return {
            ...action,
            status: 'planned'
        };
    }

    const result = spawnSync(action.command, {
        cwd: rootDir,
        shell: true,
        encoding: 'utf8'
    });

    if (result.status !== 0) {
        throw new Error(`${action.type} failed for ${action.name}: ${result.stderr || result.stdout}`);
    }

    return {
        ...action,
        status: 'ran',
        stdout: result.stdout
    };
}

function readInstalledPlugins(rootDir, llm) {
    const profile = getProfile(llm);
    if (!profile.plugins_manifest) {
        return [];
    }

    const manifestPath = path.join(rootDir, profile.plugins_manifest);
    if (!exists(manifestPath)) {
        return [];
    }

    const content = readUtf8(manifestPath);
    if (manifestPath.endsWith('.json')) {
        try {
            const parsed = JSON.parse(content);
            return Array.from(new Set(extractPluginNamesFromJson(parsed, llm)));
        } catch (error) {
            return [];
        }
    }

    return Array.from(new Set(extractPluginNamesFromToml(content)));
}

function extractPluginNamesFromJson(value, llm) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }

    const names = [];
    if (Array.isArray(value.plugins)) {
        names.push(...value.plugins.flatMap((plugin) => extractPluginNamesFromPluginArrayItem(plugin)));
    }
    if (llm === 'claude' && value.enabledPlugins && typeof value.enabledPlugins === 'object' && !Array.isArray(value.enabledPlugins)) {
        for (const [name, enabled] of Object.entries(value.enabledPlugins)) {
            if (enabled) {
                names.push(name);
            }
        }
    }
    return names;
}

function extractPluginNamesFromToml(content) {
    const names = [];
    let inPluginArray = false;

    for (const rawLine of String(content || '').split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const namedPluginMatch = line.match(/^\[plugins\.([^\]]+)\]$/u);
        if (namedPluginMatch) {
            inPluginArray = false;
            names.push(namedPluginMatch[1]);
            continue;
        }

        if (/^\[\[plugins\]\]$/u.test(line)) {
            inPluginArray = true;
            continue;
        }

        if (/^\[\[.*\]\]$/u.test(line) || /^\[.*\]$/u.test(line)) {
            inPluginArray = false;
            continue;
        }

        if (!inPluginArray) {
            continue;
        }

        const nameMatch = line.match(/^name\s*=\s*"([^"]+)"$/u);
        if (nameMatch) {
            names.push(nameMatch[1]);
        }
    }
    return names;
}

function extractPluginNamesFromPluginArrayItem(value) {
    if (typeof value === 'string') {
        return [value];
    }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
        return [value.name];
    }
    return [];
}

module.exports = {
    detectPluginDrift,
    loadPlugins,
    readInstalledPlugins,
    syncPlugins
};
