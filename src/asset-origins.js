const path = require('node:path');
const YAML = require('yaml');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');

const ASSET_ORIGINS_PATH = path.join('.harness', 'asset-origins.yaml');

function loadAssetOrigins(rootDir) {
    const filePath = path.join(rootDir, ASSET_ORIGINS_PATH);
    if (!exists(filePath)) {
        return [];
    }

    const parsed = YAML.parse(readUtf8(filePath)) || {};
    return normalizeAssetOrigins(parsed.asset_origins || []);
}

function saveAssetOrigins(rootDir, origins) {
    const filePath = path.join(rootDir, ASSET_ORIGINS_PATH);
    const normalized = normalizeAssetOrigins(origins);
    const serialized = YAML.stringify({
        asset_origins: normalized.map((origin) => ({
            kind: origin.kind,
            asset: origin.asset,
            hosts: origin.hosts,
            plugin: origin.plugin,
            source_type: origin.sourceType,
            repo: origin.repo,
            url: origin.url,
            source_path: origin.sourcePath,
            installed_version: origin.installedVersion,
            latest_version: origin.latestVersion,
            git_commit_sha: origin.gitCommitSha,
            confidence: origin.confidence,
            notes: origin.notes
        }))
    });
    writeUtf8(filePath, serialized);
    return filePath;
}

function loadAssetOriginsInput(inputPath) {
    const text = readUtf8(inputPath);
    try {
        const parsed = JSON.parse(text);
        return normalizeAssetOrigins(parsed.asset_origins || []);
    } catch (jsonError) {
        const parsed = YAML.parse(text) || {};
        return normalizeAssetOrigins(parsed.asset_origins || []);
    }
}

function normalizeAssetOrigins(origins) {
    if (!Array.isArray(origins)) {
        throw new Error('asset origins must define an asset_origins array');
    }

    return origins
        .map((origin) => normalizeAssetOrigin(origin))
        .sort(compareAssetOrigins);
}

function normalizeAssetOrigin(origin) {
    if (!origin || typeof origin !== 'object') {
        throw new Error('asset origin entries must be objects');
    }

    const kind = normalizeKind(origin.kind || origin.type);
    const asset = String(origin.asset || origin.name || '').trim();
    if (!asset) {
        throw new Error('asset origin entries must include asset');
    }

    const repo = normalizeText(origin.repo || null);
    return {
        kind,
        asset,
        hosts: normalizeHosts(origin.hosts),
        plugin: normalizeText(origin.plugin || null),
        sourceType: normalizeText(origin.sourceType || origin.source_type || null),
        repo,
        url: normalizeUrl(origin.url || null, repo),
        sourcePath: normalizeText(origin.sourcePath || origin.source_path || null),
        installedVersion: normalizeText(origin.installedVersion || origin.installed_version || null),
        latestVersion: normalizeText(origin.latestVersion || origin.latest_version || null),
        gitCommitSha: normalizeText(origin.gitCommitSha || origin.git_commit_sha || null),
        confidence: normalizeText(origin.confidence || null),
        notes: normalizeText(origin.notes || null)
    };
}

function normalizeKind(value) {
    const kind = String(value || '').trim();
    if (kind !== 'skill' && kind !== 'agent') {
        throw new Error('asset origin kind must be skill or agent');
    }
    return kind;
}

function normalizeHosts(value) {
    if (!value) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new Error('asset origin hosts must be an array');
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

function compareAssetOrigins(left, right) {
    const kindCompare = left.kind.localeCompare(right.kind);
    if (kindCompare !== 0) {
        return kindCompare;
    }
    const assetCompare = left.asset.localeCompare(right.asset);
    if (assetCompare !== 0) {
        return assetCompare;
    }
    return left.hosts.join(',').localeCompare(right.hosts.join(','));
}

function findAssetOrigin(origins, llm, kind, asset) {
    const hostFiltered = (origins || []).filter((origin) => origin.hosts.length === 0 || origin.hosts.includes(llm));
    return hostFiltered.find((origin) => origin.kind === kind && origin.asset === asset) || null;
}

module.exports = {
    ASSET_ORIGINS_PATH,
    findAssetOrigin,
    loadAssetOrigins,
    loadAssetOriginsInput,
    saveAssetOrigins
};
