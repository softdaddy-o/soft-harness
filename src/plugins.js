const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { exists, readUtf8, walkFiles } = require('./fs-util');
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
        const installed = readInstalledPluginEntries(rootDir, llm).map((entry) => entry.displayName || entry.name);
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
    return readInstalledPluginEntries(rootDir, llm).map((entry) => entry.displayName || entry.name);
}

function readInstalledPluginEntries(rootDir, llm) {
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
            return dedupePluginEntries(extractPluginEntriesFromJson(parsed, llm, rootDir));
        } catch (error) {
            return [];
        }
    }

    return dedupePluginEntries(extractPluginEntriesFromToml(content));
}

function extractPluginEntriesFromJson(value, llm, rootDir) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return [];
    }

    const entries = [];
    if (Array.isArray(value.plugins)) {
        entries.push(...value.plugins.flatMap((plugin) => extractPluginEntriesFromPluginArrayItem(plugin, {
            evidence: 'plugins[]'
        })));
    }
    if (llm === 'claude' && value.enabledPlugins && typeof value.enabledPlugins === 'object' && !Array.isArray(value.enabledPlugins)) {
        const cacheIndex = buildClaudeCacheIndex(rootDir);
        for (const [name, enabled] of Object.entries(value.enabledPlugins)) {
            if (enabled) {
                entries.push(buildClaudeEnabledPluginEntry(name, cacheIndex));
            }
        }
    }
    return entries;
}

function extractPluginEntriesFromToml(content) {
    const entries = [];
    let inPluginArray = false;

    for (const rawLine of String(content || '').split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const namedPluginMatch = line.match(/^\[plugins\.([^\]]+)\]$/u);
        if (namedPluginMatch) {
            inPluginArray = false;
            entries.push(normalizePluginEntry({
                name: namedPluginMatch[1],
                evidence: 'plugins table'
            }));
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
            entries.push(normalizePluginEntry({
                name: nameMatch[1],
                evidence: 'plugins array'
            }));
        }
    }
    return entries;
}

function extractPluginEntriesFromPluginArrayItem(value, metadata) {
    if (typeof value === 'string') {
        const identity = parsePluginIdentity(value);
        return [normalizePluginEntry({
            ...metadata,
            ...identity,
            name: identity.name
        })];
    }
    if (value && typeof value === 'object' && typeof value.name === 'string') {
        const identity = parsePluginIdentity(value.name);
        return [normalizePluginEntry({
            ...metadata,
            ...identity,
            name: identity.name,
            registry: value.registry || identity.registry || null,
            version: value.version || null,
            url: normalizeRepositoryUrl(value.url || value.repository || value.source || null),
            author: normalizePluginAuthor(value.author || null),
            description: value.description || null,
            sourceType: inferPluginSourceType({
                registry: value.registry || identity.registry || null,
                url: value.url || value.repository || value.source || null
            })
        })];
    }
    return [];
}

function buildClaudeEnabledPluginEntry(rawName, cacheIndex) {
    const identity = parsePluginIdentity(rawName);
    const cacheMeta = cacheIndex.get(rawName) || null;
    return normalizePluginEntry({
        name: identity.name,
        registry: identity.registry,
        version: cacheMeta && cacheMeta.version ? cacheMeta.version : null,
        url: cacheMeta && cacheMeta.url ? cacheMeta.url : null,
        author: cacheMeta && cacheMeta.author ? cacheMeta.author : null,
        description: cacheMeta && cacheMeta.description ? cacheMeta.description : null,
        sourceType: cacheMeta && cacheMeta.sourceType ? cacheMeta.sourceType : (identity.registry ? 'marketplace' : 'declared'),
        inferred: Boolean(cacheMeta),
        evidence: cacheMeta ? 'enabledPlugins + cache metadata' : 'enabledPlugins'
    });
}

function buildClaudeCacheIndex(rootDir) {
    const index = new Map();
    const cacheRoot = path.join(rootDir, '.claude', 'plugins', 'cache');
    if (!exists(cacheRoot)) {
        return index;
    }

    const files = walkFiles(cacheRoot, (relativePath) => {
        const normalized = relativePath.replace(/\\/g, '/');
        return normalized.endsWith('/.claude-plugin/plugin.json')
            || normalized.endsWith('/.claude-plugin/marketplace.json')
            || normalized.endsWith('/package.json');
    });

    for (const file of files) {
        const relativePath = file.relativePath.replace(/\\/g, '/');
        const parts = relativePath.split('/');
        if (parts.length < 4) {
            continue;
        }

        const [registry, name, version] = parts;
        const key = `${name}@${registry}`;
        const current = index.get(key) || {
            name,
            registry,
            version,
            sourceType: 'marketplace',
            url: null,
            author: null,
            description: null
        };

        try {
            const parsed = JSON.parse(readUtf8(file.absolutePath));
            if (relativePath.endsWith('/.claude-plugin/plugin.json')) {
                current.version = parsed.version || current.version;
                current.url = normalizeRepositoryUrl(parsed.repository || parsed.url || parsed.homepage || current.url);
                current.author = normalizePluginAuthor(parsed.author || current.author);
                current.description = parsed.description || current.description;
            } else if (relativePath.endsWith('/.claude-plugin/marketplace.json')) {
                const plugin = Array.isArray(parsed.plugins)
                    ? parsed.plugins.find((entry) => entry && entry.name === name)
                    : null;
                current.version = (plugin && plugin.version) || current.version;
                current.url = normalizeRepositoryUrl((plugin && (plugin.url || plugin.repository || plugin.source)) || current.url);
                current.author = normalizePluginAuthor((plugin && plugin.author) || (parsed.owner && parsed.owner.name) || current.author);
                current.description = (plugin && plugin.description) || (parsed.metadata && parsed.metadata.description) || current.description;
            } else if (relativePath.endsWith('/package.json')) {
                current.url = normalizeRepositoryUrl(parsed.repository || parsed.homepage || current.url);
                current.author = normalizePluginAuthor(parsed.author || current.author);
                current.description = parsed.description || current.description;
            }
        } catch (error) {
            // Ignore malformed cache metadata and keep the registry/path inference.
        }

        current.sourceType = inferPluginSourceType(current);

        index.set(key, current);
    }

    return index;
}

function parsePluginIdentity(value) {
    const text = String(value || '').trim();
    const separator = text.lastIndexOf('@');
    if (separator > 0) {
        return {
            name: text.slice(0, separator),
            registry: text.slice(separator + 1)
        };
    }
    return {
        name: text,
        registry: null
    };
}

function normalizePluginEntry(entry) {
    const normalized = {
        name: entry.name,
        registry: entry.registry || null,
        version: entry.version || null,
        url: normalizeRepositoryUrl(entry.url || null),
        author: normalizePluginAuthor(entry.author || null),
        description: entry.description ? String(entry.description) : null,
        sourceType: entry.sourceType || inferPluginSourceType(entry),
        inferred: Boolean(entry.inferred),
        evidence: entry.evidence || null
    };
    normalized.displayName = normalized.registry ? `${normalized.name}@${normalized.registry}` : normalized.name;
    return normalized;
}

function inferPluginSourceType(entry) {
    const url = normalizeRepositoryUrl(entry && entry.url);
    if (url && /github\.com/i.test(url)) {
        return 'github';
    }
    if (entry && entry.registry) {
        return 'marketplace';
    }
    return 'declared';
}

function normalizeRepositoryUrl(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        return normalizeRepositoryUrl(value.url || value.repository || null);
    }
    const text = String(value).trim();
    if (!text || text === '.' || text === './') {
        return null;
    }
    if (/^github:/i.test(text)) {
        return `https://github.com/${text.slice('github:'.length)}`;
    }
    return text.replace(/^git\+/i, '').replace(/\.git$/i, '');
}

function normalizePluginAuthor(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        return normalizePluginAuthor(value.name || value.login || value.email || null);
    }
    const text = String(value).trim();
    return text || null;
}

function dedupePluginEntries(entries) {
    const merged = new Map();
    for (const entry of entries || []) {
        if (!entry || !entry.name) {
            continue;
        }
        const key = entry.displayName || `${entry.name}@${entry.registry || ''}`;
        const current = merged.get(key);
        if (!current) {
            merged.set(key, entry);
            continue;
        }
        merged.set(key, normalizePluginEntry({
            ...current,
            version: current.version || entry.version,
            url: current.url || entry.url,
            author: current.author || entry.author,
            description: current.description || entry.description,
            sourceType: current.sourceType !== 'declared' ? current.sourceType : entry.sourceType,
            inferred: current.inferred && entry.inferred,
            evidence: current.evidence || entry.evidence
        }));
    }
    return Array.from(merged.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
}

module.exports = {
    detectPluginDrift,
    loadPlugins,
    readInstalledPluginEntries,
    readInstalledPlugins,
    syncPlugins
};
