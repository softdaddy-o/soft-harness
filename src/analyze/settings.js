const path = require('node:path');
const { exists, readUtf8 } = require('../fs-util');
const { listProfiles, getProfile } = require('../profiles');
const { resolveSettingsReadTarget } = require('../settings-targets');
const { createFinding, normalizeText, similarity } = require('./shared');

function analyzeSettings(rootDir, options) {
    const findings = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };
    const settings = [];
    const llms = selectLlms(options);
    const mcpEntries = [];

    for (const llm of llms) {
        const profile = getProfile(llm);
        const source = resolveSettingsReadTarget(rootDir, llm, options);
        if (!source) {
            continue;
        }
        if (!exists(source.absolutePath)) {
            continue;
        }

        try {
            const parsed = parseSettingsFile(source.displayPath, readUtf8(source.absolutePath), {
                llm,
                profile,
                projectRoot: rootDir,
                sourceScope: source.scope
            });
            settings.push({
                llm,
                file: source.displayPath,
                scope: source.scope,
                format: parsed.format,
                status: 'parsed',
                mcpServers: parsed.mcpServers.map((server) => server.name),
                hostOnlyKeys: parsed.hostOnlyKeys,
                projectEntry: parsed.projectEntry || null,
                scopeNote: profile.settings_scope_note || null,
                capabilities: profile.settings_capabilities || null
            });
            mcpEntries.push(...parsed.mcpServers.map((server) => ({
                ...server,
                llm,
                scope: source.scope,
                sourceFile: source.displayPath
            })));

            for (const key of parsed.hostOnlyKeys) {
                findings.hostOnly.push(createFinding('hostOnly', {
                    category: 'settings',
                    kind: 'key',
                    key: `settings.${llm}.${key}`,
                    sources: [{
                        llm,
                        file: source.displayPath,
                        path: `${source.displayPath}#${key}`,
                        scope: source.scope
                    }],
                    reason: buildHostOnlyKeyReason(llm, key, source.scope)
                }));
            }
        } catch (error) {
            settings.push({
                llm,
                file: source.displayPath,
                scope: source.scope,
                format: detectSettingsFormat(source.displayPath),
                status: 'parse-error',
                mcpServers: [],
                hostOnlyKeys: [],
                scopeNote: profile.settings_scope_note || null,
                capabilities: profile.settings_capabilities || null,
                error: error.message
            });
            findings.unknown.push(createFinding('unknown', {
                category: 'settings',
                kind: 'file',
                key: `settings.${llm}`,
                sources: [{
                    llm,
                    file: source.displayPath,
                    path: source.displayPath,
                    scope: source.scope
                }],
                reason: `settings adapter could not parse file: ${error.message}`
            }));
        }
    }

    const byName = new Map();
    for (const entry of mcpEntries) {
        if (!byName.has(entry.name)) {
            byName.set(entry.name, []);
        }
        byName.get(entry.name).push(entry);
    }

    for (const [name, members] of byName.entries()) {
        const uniqueHashes = new Set(members.map((member) => member.hash));
        if (new Set(members.map((member) => member.llm)).size === 1) {
            findings.hostOnly.push(createFinding('hostOnly', {
                category: 'settings',
                kind: 'mcp',
                key: `settings.mcp.${name}`,
                sources: members.map((member) => createSettingsSource(member)),
                reason: 'server is configured for only one host'
            }));
            continue;
        }

        if (uniqueHashes.size === 1) {
            findings.common.push(createFinding('common', {
                category: 'settings',
                kind: 'mcp',
                key: `settings.mcp.${name}`,
                sources: members.map((member) => createSettingsSource(member)),
                reason: 'normalized MCP definition is identical'
            }));
            continue;
        }

        const comparison = classifySettingsDifference(members);
        const bucket = comparison.bucket;
        findings[bucket].push(createFinding(bucket, {
            category: 'settings',
            kind: 'mcp',
            key: `settings.mcp.${name}`,
            sources: members.map((member) => createSettingsSource(member)),
            reason: comparison.reason,
            score: comparison.score
        }));
    }

    return {
        findings,
        settings
    };
}

function parseSettingsFile(settingsPath, content, context) {
    if (settingsPath.endsWith('.json')) {
        return parseJsonSettings(content);
    }
    if (settingsPath.endsWith('.toml')) {
        return parseTomlSettings(content, context);
    }
    throw new Error(`unsupported settings file type: ${settingsPath}`);
}

function parseJsonSettings(content) {
    const parsed = JSON.parse(content);
    const mcpServers = Object.entries(parsed.mcpServers || {}).map(([name, value]) => buildMcpServer(name, value));
    const hostOnlyKeys = Object.keys(parsed).filter((key) => key !== 'mcpServers');
    return {
        format: 'json',
        mcpServers,
        hostOnlyKeys
    };
}

function parseTomlSettings(content, context) {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const hostOnlyKeys = [];
    const mcpServers = {};
    const projectSections = new Map();
    let section = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const sectionMatch = /^\[(.+?)\]$/.exec(line);
        if (sectionMatch) {
            section = sectionMatch[1];
            continue;
        }
        if (line.startsWith('[')) {
            throw new Error(`invalid TOML section: ${line}`);
        }

        const kvMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
        if (!kvMatch) {
            continue;
        }

        const key = kvMatch[1];
        const value = parseTomlValue(kvMatch[2]);
        if (section && section.startsWith('mcp_servers.')) {
            const serverName = section.replace(/^mcp_servers\./, '');
            if (!mcpServers[serverName]) {
                mcpServers[serverName] = {};
            }
            mcpServers[serverName][key] = value;
        } else if (section && section.startsWith('projects.')) {
            const projectKey = parseTomlSectionName(section.replace(/^projects\./, ''));
            if (!projectSections.has(projectKey)) {
                projectSections.set(projectKey, {});
            }
            projectSections.get(projectKey)[key] = value;
        } else if (section) {
            hostOnlyKeys.push(`${section}.${key}`);
        } else {
            hostOnlyKeys.push(key);
        }
    }

    const currentProject = selectCurrentProjectSection(projectSections, context);
    if (currentProject) {
        hostOnlyKeys.push(...Object.keys(currentProject.values).map((key) => `project.${key}`));
    }

    return {
        format: 'toml',
        mcpServers: Object.entries(mcpServers).map(([name, value]) => buildMcpServer(name, value)),
        hostOnlyKeys,
        projectEntry: currentProject ? currentProject.projectKey : null
    };
}

function detectSettingsFormat(settingsPath) {
    if (settingsPath.endsWith('.json')) {
        return 'json';
    }
    if (settingsPath.endsWith('.toml')) {
        return 'toml';
    }
    return 'unknown';
}

function parseTomlValue(rawValue) {
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
        const inner = value.slice(1, -1).trim();
        if (!inner) {
            return [];
        }
        return inner.split(',').map((item) => parseTomlValue(item));
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
        return value.slice(1, -1);
    }
    if (value === 'true' || value === 'false') {
        return value === 'true';
    }
    return value;
}

function parseTomlSectionName(value) {
    const trimmed = String(value || '').trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function buildMcpServer(name, value) {
    const normalized = {
        transport: value.transport || 'stdio',
        command: value.command || '',
        args: Array.isArray(value.args) ? value.args : [],
        cwd: value.cwd || '',
        env_names: Array.isArray(value.env_passthrough)
            ? value.env_passthrough.slice()
            : value.env && typeof value.env === 'object'
                ? Object.keys(value.env).sort()
                : [],
        enabled: typeof value.enabled === 'boolean' ? value.enabled : true
    };

    return {
        name,
        normalized,
        hash: normalizeText(JSON.stringify(normalized))
    };
}

function calculateSettingsSimilarity(members) {
    let best = 0;
    for (let index = 0; index < members.length; index += 1) {
        for (let inner = index + 1; inner < members.length; inner += 1) {
            const left = JSON.stringify(members[index].normalized);
            const right = JSON.stringify(members[inner].normalized);
            best = Math.max(best, similarity(left, right));
        }
    }
    return best;
}

function classifySettingsDifference(members) {
    const commands = new Set(members.map((member) => member.normalized.command));
    const transports = new Set(members.map((member) => member.normalized.transport));
    if (commands.size > 1 || transports.size > 1) {
        return {
            bucket: 'conflicts',
            reason: 'same MCP server name, but command or transport differs by host'
        };
    }

    const score = calculateSettingsSimilarity(members);
    if (score >= 0.8) {
        return {
            bucket: 'similar',
            reason: `same MCP server name, but normalized definitions differ (similarity=${score.toFixed(2)})`,
            score
        };
    }

    return {
        bucket: 'conflicts',
        reason: 'same MCP server name, but definitions are incompatible'
    };
}

function createSettingsSource(member) {
    return {
        llm: member.llm,
        file: member.sourceFile,
        path: `${member.sourceFile}#${member.name}`,
        scope: member.scope
    };
}

function selectLlms(options) {
    const requested = options && options.llms;
    if (!requested || requested.length === 0) {
        return listProfiles();
    }
    return requested;
}

function selectCurrentProjectSection(projectSections, context) {
    if (!context || context.llm !== 'codex' || context.sourceScope !== 'account' || !context.projectRoot) {
        return null;
    }

    const expected = normalizeComparablePath(context.projectRoot);
    for (const [projectKey, values] of projectSections.entries()) {
        if (normalizeComparablePath(projectKey) === expected) {
            return {
                projectKey,
                values
            };
        }
    }
    return null;
}

function normalizeComparablePath(value) {
    const withoutPrefix = String(value || '')
        .trim()
        .replace(/^\\\\\?\\/u, '')
        .replace(/[\\/]+$/u, '');
    const normalizedSeparators = withoutPrefix.replace(/[\\/]+/g, path.sep);
    const resolved = path.isAbsolute(normalizedSeparators)
        ? path.resolve(normalizedSeparators)
        : normalizedSeparators;
    return path.sep === '\\'
        ? resolved.toLowerCase()
        : resolved;
}

function buildHostOnlyKeyReason(llm, key, scope) {
    if (llm === 'codex' && scope === 'account' && key.startsWith('project.')) {
        return 'Codex stores this project-specific key in the account config under [projects.*]';
    }
    if (llm === 'codex' && scope === 'account') {
        return 'Codex stores this key in the account config and no portable cross-host mapping is defined';
    }
    return 'no portable cross-host mapping is defined';
}

module.exports = {
    analyzeSettings
};
