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
    const llms = selectLlms(options);
    const mcpEntries = [];

    for (const llm of llms) {
        const profile = getProfile(llm);
        const settingsPath = profile.plugins_manifest;
        if (!settingsPath) {
            continue;
        }

        const absolutePath = path.join(rootDir, settingsPath);
        if (!exists(absolutePath)) {
            continue;
        }

        try {
            const parsed = parseSettingsFile(settingsPath, readUtf8(absolutePath));
            mcpEntries.push(...parsed.mcpServers.map((server) => ({
                ...server,
                llm,
                sourceFile: settingsPath
            })));

            for (const key of parsed.hostOnlyKeys) {
                findings.hostOnly.push(createFinding('hostOnly', {
                    category: 'settings',
                    kind: 'key',
                    key: `settings.${llm}.${key}`,
                    sources: [{
                        llm,
                        file: settingsPath,
                        path: `${settingsPath}#${key}`
                    }],
                    reason: 'no portable cross-host mapping is defined'
                }));
            }
        } catch (error) {
            findings.unknown.push(createFinding('unknown', {
                category: 'settings',
                kind: 'file',
                key: `settings.${llm}`,
                sources: [{
                    llm,
                    file: settingsPath,
                    path: settingsPath
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
            reason: comparison.reason
        }));
    }

    return findings;
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
        mcpServers,
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
        mcpServers: Object.entries(mcpServers).map(([name, value]) => buildMcpServer(name, value)),
        hostOnlyKeys: Object.keys(root)
    };
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
            reason: `same MCP server name, but normalized definitions differ (similarity=${score.toFixed(2)})`
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

module.exports = {
    analyzeSettings
};
