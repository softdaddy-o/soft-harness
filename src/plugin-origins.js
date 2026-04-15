const path = require('node:path');
const YAML = require('yaml');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');

const PLUGIN_ORIGINS_PATH = path.join('.harness', 'plugin-origins.yaml');

function loadPluginOrigins(rootDir) {
    const filePath = path.join(rootDir, PLUGIN_ORIGINS_PATH);
    if (!exists(filePath)) {
        return [];
    }

    const parsed = YAML.parse(readUtf8(filePath)) || {};
    return normalizePluginOrigins(parsed.plugin_origins || []);
}

function savePluginOrigins(rootDir, origins) {
    const filePath = path.join(rootDir, PLUGIN_ORIGINS_PATH);
    const normalized = normalizePluginOrigins(origins);
    const serialized = YAML.stringify({
        plugin_origins: normalized.map((origin) => ({
            plugin: origin.plugin,
            hosts: origin.hosts,
            source_type: origin.sourceType,
            repo: origin.repo,
            url: origin.url,
            latest_version: origin.latestVersion,
            confidence: origin.confidence,
            notes: origin.notes
        }))
    });
    writeUtf8(filePath, serialized);
    return filePath;
}

function loadPluginOriginsInput(inputPath) {
    const text = readUtf8(inputPath);
    try {
        const parsed = JSON.parse(text);
        return normalizePluginOrigins(parsed.plugin_origins || []);
    } catch (jsonError) {
        const parsed = YAML.parse(text) || {};
        return normalizePluginOrigins(parsed.plugin_origins || []);
    }
}

function normalizePluginOrigins(origins) {
    if (!Array.isArray(origins)) {
        throw new Error('plugin origins must define a plugin_origins array');
    }

    return origins
        .map((origin) => normalizePluginOrigin(origin))
        .sort(comparePluginOrigins);
}

function normalizePluginOrigin(origin) {
    if (!origin || typeof origin !== 'object') {
        throw new Error('plugin origin entries must be objects');
    }
    const plugin = String(origin.plugin || '').trim();
    if (!plugin) {
        throw new Error('plugin origin entries must include plugin');
    }

    const hosts = normalizeHosts(origin.hosts);
    return {
        plugin,
        hosts,
        sourceType: normalizeText(origin.sourceType || origin.source_type || null),
        repo: normalizeText(origin.repo || null),
        url: normalizeUrl(origin.url || null, origin.repo || null),
        latestVersion: normalizeText(origin.latestVersion || origin.latest_version || null),
        confidence: normalizeText(origin.confidence || null),
        notes: normalizeText(origin.notes || null)
    };
}

function normalizeHosts(value) {
    if (!value) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('plugin origin hosts must be an array');
    }
    return Array.from(new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))).sort();
}

function normalizeText(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const text = String(value).trim();
    return text || null;
}

function normalizeUrl(value, repo) {
    const explicit = normalizeText(value);
    if (explicit) {
        return explicit;
    }
    const repoText = normalizeText(repo);
    if (repoText && /^[^/]+\/[^/]+$/u.test(repoText)) {
        return `https://github.com/${repoText}`;
    }
    return null;
}

function comparePluginOrigins(left, right) {
    const pluginCompare = left.plugin.localeCompare(right.plugin);
    if (pluginCompare !== 0) {
        return pluginCompare;
    }
    return left.hosts.join(',').localeCompare(right.hosts.join(','));
}

function findPluginOrigin(origins, llm, plugin) {
    const displayName = plugin.displayName || plugin.name;
    const hostFiltered = (origins || []).filter((origin) => origin.hosts.length === 0 || origin.hosts.includes(llm));
    return hostFiltered.find((origin) => origin.plugin === displayName)
        || hostFiltered.find((origin) => origin.plugin === plugin.name)
        || null;
}

module.exports = {
    PLUGIN_ORIGINS_PATH,
    findPluginOrigin,
    loadPluginOrigins,
    loadPluginOriginsInput,
    savePluginOrigins
};
