const path = require('node:path');
const { exists, readUtf8 } = require('../fs-util');
const { listProfiles, getProfile } = require('../profiles');
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
    const mcpOverrideEntries = [];

    for (const llm of llms) {
        for (const target of getSettingsTargets(rootDir, llm, options)) {
            const absolutePath = path.join(target.rootDir, target.settingsPath);
            if (!exists(absolutePath)) {
                continue;
            }

            try {
                const parsed = parseSettingsFile(target.settingsPath, readUtf8(absolutePath));
                settings.push({
                    llm,
                    file: target.displayFile,
                    scope: target.scope,
                    format: parsed.format,
                    status: 'parsed',
                    mcpServers: parsed.mcpServers.map((server) => server.name),
                    mcpOverrides: parsed.mcpOverrides.map((override) => override.name),
                    hostOnlyKeys: parsed.hostOnlyKeys
                });
                mcpEntries.push(...parsed.mcpServers.map((server) => ({
                    ...server,
                    llm,
                    sourceFile: target.displayFile
                })));
                mcpOverrideEntries.push(...parsed.mcpOverrides.map((override) => ({
                    ...override,
                    llm,
                    sourceFile: target.displayFile
                })));

                for (const key of parsed.hostOnlyKeys) {
                    findings.hostOnly.push(createFinding('hostOnly', {
                        category: 'settings',
                        kind: 'key',
                        key: `settings.${llm}.${key}`,
                        sources: [{
                            llm,
                            file: target.displayFile,
                            path: `${target.displayFile}#${key}`
                        }],
                        reason: 'no portable cross-host mapping is defined'
                    }));
                }
            } catch (error) {
                settings.push({
                    llm,
                    file: target.displayFile,
                    scope: target.scope,
                    format: detectSettingsFormat(target.settingsPath),
                    status: 'parse-error',
                    mcpServers: [],
                    mcpOverrides: [],
                    hostOnlyKeys: [],
                    error: error.message
                });
                findings.unknown.push(createFinding('unknown', {
                    category: 'settings',
                    kind: 'file',
                    key: `settings.${llm}`,
                    sources: [{
                        llm,
                        file: target.displayFile,
                        path: target.displayFile
                    }],
                    reason: `settings adapter could not parse file: ${error.message}`
                }));
            }
        }
    }

    for (const entry of mcpOverrideEntries) {
        findings.hostOnly.push(createFinding('hostOnly', {
            category: 'settings',
            kind: 'mcp_override',
            key: `settings.mcp_override.${entry.name}`,
            sources: [createSettingsSource(entry)],
            reason: 'project-scoped Codex MCP override is intentionally host-local'
        }));
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

function parseSettingsFile(settingsPath, content) {
    if (settingsPath.endsWith('.json')) {
        return parseJsonSettings(content);
    }
    if (settingsPath.endsWith('.toml')) {
        return parseTomlSettings(content);
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
        mcpOverrides: [],
        hostOnlyKeys
    };
}

function parseTomlSettings(content) {
    const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
    const root = {};
    const mcpServers = {};
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
        } else {
            root[key] = value;
        }
    }

    return {
        format: 'toml',
        mcpServers: Object.entries(mcpServers)
            .filter(([, value]) => !isMcpOverride(value))
            .map(([name, value]) => buildMcpServer(name, value)),
        mcpOverrides: Object.entries(mcpServers)
            .filter(([, value]) => isMcpOverride(value))
            .map(([name, value]) => buildMcpOverride(name, value)),
        hostOnlyKeys: Object.keys(root)
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

function buildMcpOverride(name, value) {
    const normalized = {
        enabled: value.enabled
    };

    return {
        name,
        normalized,
        hash: normalizeText(JSON.stringify(normalized))
    };
}

function isMcpOverride(value) {
    return typeof value.enabled === 'boolean' && !hasFullMcpDefinition(value);
}

function hasFullMcpDefinition(value) {
    return Boolean(value.command
        || value.transport
        || value.cwd
        || (Array.isArray(value.args) && value.args.length > 0)
        || (Array.isArray(value.env_passthrough) && value.env_passthrough.length > 0)
        || (value.env && typeof value.env === 'object' && Object.keys(value.env).length > 0));
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
        path: `${member.sourceFile}#${member.name}`
    };
}

function selectLlms(options) {
    const requested = options && options.llms;
    if (!requested || requested.length === 0) {
        return listProfiles();
    }
    return requested;
}

function getSettingsTargets(rootDir, llm, options) {
    const profile = getProfile(llm);
    const settingsPath = profile.settings_file || profile.plugins_manifest;
    if (!settingsPath) {
        return [];
    }

    const targets = [];
    const accountRoot = llm === 'codex' && options && options.accountRoot
        ? path.resolve(options.accountRoot)
        : null;
    const root = path.resolve(rootDir);
    const projectSettingsPath = path.resolve(root, settingsPath);
    if (accountRoot) {
        const accountSettingsPath = path.resolve(accountRoot, settingsPath);
        if (accountSettingsPath !== projectSettingsPath) {
            targets.push({
                rootDir: accountRoot,
                settingsPath,
                displayFile: `~/${settingsPath}`,
                scope: 'account'
            });
        }
    }

    targets.push({
        rootDir: root,
        settingsPath,
        displayFile: settingsPath,
        scope: options && options.account ? 'account' : 'project'
    });
    return targets;
}

module.exports = {
    analyzeSettings
};
