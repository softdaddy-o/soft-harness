const path = require('node:path');
const { exists } = require('./fs-util');
const profiles = require('./profiles');

const CODEX_ACCOUNT_EXPORT_REASON = 'Codex MCP settings are exported to the account config until project-local Codex MCP support is confirmed.';
const CODEX_ACCOUNT_EXPORT_DETAIL = 'this writes shared Codex MCP state to ~/.codex/config.toml instead of a repo-local .codex/config.toml file';
const CODEX_HOME_FALLBACK_REASON = 'Codex account config could not be resolved from HOME or USERPROFILE, so soft-harness fell back to the project path.';
const CODEX_HOME_FALLBACK_DETAIL = 'set HOME or USERPROFILE to let soft-harness route Codex MCP settings to ~/.codex/config.toml';

function resolveSettingsReadTarget(rootDir, llm, options) {
    const profile = profiles.getProfile(llm);
    const settingsPath = profile.settings_file || profile.plugins_manifest;
    if (!settingsPath) {
        return null;
    }

    if (llm !== 'codex') {
        return buildProjectTarget(rootDir, settingsPath);
    }

    const projectTarget = buildProjectTarget(rootDir, settingsPath);
    if (projectTarget.exists) {
        return projectTarget;
    }

    const homeDir = resolveSettingsHomeDir(options);
    if (!homeDir) {
        return null;
    }

    return buildAccountTarget(homeDir, settingsPath);
}

function resolveSettingsWriteTarget(rootDir, llm, options) {
    const profile = profiles.getProfile(llm);
    const settingsPath = profile.settings_file || profile.plugins_manifest;
    if (!settingsPath) {
        return null;
    }

    if (llm !== 'codex') {
        return buildProjectTarget(rootDir, settingsPath);
    }

    const homeDir = resolveSettingsHomeDir(options);
    if (!homeDir) {
        return {
            ...buildProjectTarget(rootDir, settingsPath),
            reason: CODEX_HOME_FALLBACK_REASON,
            detail: CODEX_HOME_FALLBACK_DETAIL
        };
    }

    return {
        ...buildAccountTarget(homeDir, settingsPath),
        reason: CODEX_ACCOUNT_EXPORT_REASON,
        detail: CODEX_ACCOUNT_EXPORT_DETAIL
    };
}

function resolveSettingsHomeDir(options) {
    const configuredHome = options && (options.homeDir || options.accountRoot);
    if (configuredHome) {
        return path.resolve(configuredHome);
    }

    const envHome = process.env.USERPROFILE || process.env.HOME;
    return envHome ? path.resolve(envHome) : '';
}

function buildProjectTarget(rootDir, relativePath) {
    const absolutePath = path.join(rootDir, relativePath);
    return {
        scope: 'project',
        displayPath: relativePath,
        path: relativePath,
        absolutePath,
        exists: exists(absolutePath)
    };
}

function buildAccountTarget(homeDir, relativePath) {
    const absolutePath = path.join(homeDir, relativePath);
    const displayPath = formatHomeDisplayPath(relativePath);
    return {
        scope: 'account',
        displayPath,
        path: displayPath,
        absolutePath,
        exists: exists(absolutePath)
    };
}

function formatHomeDisplayPath(relativePath) {
    return `~/${String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/u, '')}`;
}

module.exports = {
    CODEX_ACCOUNT_EXPORT_DETAIL,
    CODEX_ACCOUNT_EXPORT_REASON,
    resolveSettingsHomeDir,
    resolveSettingsReadTarget,
    resolveSettingsWriteTarget
};
