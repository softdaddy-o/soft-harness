const path = require('node:path');
const YAML = require('yaml');
const { exists, readUtf8, walkFiles } = require('./fs-util');
const { listProfiles, getProfile } = require('./profiles');

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
        if (!plugin.name || !Array.isArray(plugin.llms) || plugin.llms.length === 0) {
            throw new Error('plugins must include name and llms');
        }
        if (plugin.llms.some((llm) => !knownLlms.has(llm))) {
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
    const desiredMap = new Map(desired.map((plugin) => [plugin.name, normalizeDesiredPlugin(plugin)]));
    const actions = [];

    for (const plugin of desiredMap.values()) {
        const prior = previous.get(plugin.name);
        if (!prior || JSON.stringify(prior) !== JSON.stringify(plugin)) {
            actions.push(buildPluginAction('track', plugin, options));
        }
    }

    for (const plugin of previous.values()) {
        if (desiredMap.has(plugin.name)) {
            continue;
        }
        actions.push(buildPluginAction('remove', plugin, options));
    }

    return {
        actions,
        state: Array.from(desiredMap.values()).sort((left, right) => left.name.localeCompare(right.name))
    };
}

function buildPluginAction(type, plugin, options) {
    return {
        type,
        name: plugin.name,
        version: plugin.version || null,
        llms: plugin.llms || [],
        status: options && options.dryRun ? 'planned' : 'tracked'
    };
}

function normalizeDesiredPlugin(plugin) {
    return {
        name: plugin.name,
        llms: plugin.llms.slice().sort(),
        version: plugin.version || null,
        registry: plugin.registry || null,
        source_type: plugin.source_type || null,
        url: normalizeRepositoryUrl(plugin.url || null),
        author: normalizePluginAuthor(plugin.author || null),
        description: plugin.description || null
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
        repo: cacheMeta && cacheMeta.repo ? cacheMeta.repo : null,
        sourcePath: cacheMeta && cacheMeta.sourcePath ? cacheMeta.sourcePath : null,
        gitCommitSha: cacheMeta && cacheMeta.gitCommitSha ? cacheMeta.gitCommitSha : null,
        author: cacheMeta && cacheMeta.author ? cacheMeta.author : null,
        description: cacheMeta && cacheMeta.description ? cacheMeta.description : null,
        sourceType: cacheMeta && cacheMeta.sourceType ? cacheMeta.sourceType : (identity.registry ? 'marketplace' : 'declared'),
        inferred: Boolean(cacheMeta),
        evidence: cacheMeta ? mergeEvidence('enabledPlugins', cacheMeta.evidence || 'cache metadata') : 'enabledPlugins'
    });
}

function buildClaudeCacheIndex(rootDir) {
    const index = new Map();
    const marketplaceIndex = buildClaudeMarketplaceIndex(rootDir);
    const installedIndex = buildClaudeInstalledPluginIndex(rootDir);

    for (const metadata of marketplaceIndex.values()) {
        mergeClaudePluginIndexEntry(index, metadata);
    }
    for (const metadata of installedIndex.values()) {
        mergeClaudePluginIndexEntry(index, metadata);
    }

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
        let current = index.get(key) || {
            name,
            registry,
            version,
            sourceType: 'marketplace',
            url: null,
            repo: null,
            sourcePath: null,
            gitCommitSha: null,
            author: null,
            description: null,
            evidence: null
        };
        current = mergeClaudePluginMetadata(current, {
            name,
            registry,
            version,
            evidence: 'cache metadata'
        });

        try {
            const parsed = JSON.parse(readUtf8(file.absolutePath));
            if (relativePath.endsWith('/.claude-plugin/plugin.json')) {
                current = mergeClaudePluginMetadata(current, {
                    version: parsed.version || null,
                    url: normalizeRepositoryUrl(parsed.repository || parsed.url || parsed.homepage || null),
                    repo: extractGithubRepo(parsed.repository || parsed.url || parsed.homepage || null),
                    author: normalizePluginAuthor(parsed.author || null),
                    description: parsed.description || null,
                    evidence: 'cache metadata'
                });
            } else if (relativePath.endsWith('/.claude-plugin/marketplace.json')) {
                const plugin = Array.isArray(parsed.plugins)
                    ? parsed.plugins.find((entry) => entry && entry.name === name)
                    : null;
                const sourceInfo = normalizeMarketplaceSource(plugin && (plugin.source || plugin.repository || plugin.url || plugin.homepage), {
                    repo: current.repo,
                    url: current.url
                });
                current = mergeClaudePluginMetadata(current, {
                    version: (plugin && plugin.version) || null,
                    url: sourceInfo.url || null,
                    repo: sourceInfo.repo || null,
                    sourcePath: sourceInfo.sourcePath || null,
                    author: normalizePluginAuthor((plugin && plugin.author) || (parsed.owner && parsed.owner.name) || null),
                    description: (plugin && plugin.description) || (parsed.metadata && parsed.metadata.description) || null,
                    evidence: 'cache metadata'
                });
            } else if (relativePath.endsWith('/package.json')) {
                current = mergeClaudePluginMetadata(current, {
                    url: normalizeRepositoryUrl(parsed.repository || parsed.homepage || null),
                    repo: extractGithubRepo(parsed.repository || parsed.homepage || null),
                    author: normalizePluginAuthor(parsed.author || null),
                    description: parsed.description || null,
                    evidence: 'cache metadata'
                });
            }
        } catch (error) {
            // Ignore malformed cache metadata and keep the registry/path inference.
        }

        current.sourceType = inferPluginSourceType(current);

        index.set(key, current);
    }

    return index;
}

function buildClaudeMarketplaceIndex(rootDir) {
    const index = new Map();
    const registryIndex = buildClaudeMarketplaceRegistryIndex(rootDir);

    for (const registryMeta of registryIndex.values()) {
        const marketplacePath = path.join(registryMeta.dir, '.claude-plugin', 'marketplace.json');
        const parsed = readJsonSafely(marketplacePath);
        if (!parsed || !Array.isArray(parsed.plugins)) {
            continue;
        }

        for (const plugin of parsed.plugins) {
            if (!plugin || typeof plugin.name !== 'string') {
                continue;
            }

            const sourceInfo = normalizeMarketplaceSource(plugin.source || plugin.repository || plugin.url || plugin.homepage, registryMeta);
            const registrySourceInfo = {
                repo: registryMeta.repo || null,
                url: registryMeta.url || null
            };
            const sourcePath = sourceInfo.sourcePath || null;
            const repo = sourceInfo.repo || (sourcePath ? registrySourceInfo.repo : null);
            const url = sourceInfo.url || (sourceInfo.repo && sourcePath ? githubTreeUrl(sourceInfo.repo, sourcePath) : null);
            const metadata = {
                name: plugin.name,
                registry: registryMeta.registry,
                version: plugin.version || null,
                url: url || null,
                repo,
                sourcePath,
                author: normalizePluginAuthor(plugin.author || (parsed.owner && parsed.owner.name) || null),
                description: plugin.description || null,
                sourceType: repo ? 'github' : 'marketplace',
                evidence: mergeEvidence(registryMeta.evidence, 'marketplace metadata')
            };

            if (!metadata.url && metadata.repo && metadata.sourcePath) {
                metadata.url = githubTreeUrl(metadata.repo, metadata.sourcePath);
            }
            if (!metadata.url && metadata.repo && !metadata.sourcePath && sourceInfo.repo) {
                metadata.url = githubRepoUrl(metadata.repo);
            }
            if (!metadata.repo && metadata.url) {
                metadata.repo = extractGithubRepo(metadata.url);
            }

            mergeClaudePluginIndexEntry(index, metadata);
        }
    }

    return index;
}

function buildClaudeMarketplaceRegistryIndex(rootDir) {
    const index = new Map();
    const pluginsRoot = path.join(rootDir, '.claude', 'plugins');
    const marketplacesRoot = path.join(pluginsRoot, 'marketplaces');
    const knownMarketplacesPath = path.join(pluginsRoot, 'known_marketplaces.json');
    const knownMarketplaces = readJsonSafely(knownMarketplacesPath) || {};

    if (knownMarketplaces && typeof knownMarketplaces === 'object' && !Array.isArray(knownMarketplaces)) {
        for (const [registry, value] of Object.entries(knownMarketplaces)) {
            const sourceInfo = normalizeMarketplaceSource(value && value.source ? value.source : value, {});
            const installLocation = value && typeof value === 'object' && value.installLocation
                ? value.installLocation
                : path.join(marketplacesRoot, registry);
            const gitInfo = readGitRemoteInfo(installLocation);
            index.set(registry, {
                registry,
                dir: installLocation,
                repo: sourceInfo.repo || gitInfo.repo || null,
                url: sourceInfo.url || gitInfo.url || null,
                evidence: mergeEvidence(sourceInfo.repo || sourceInfo.url ? 'known_marketplaces' : null, gitInfo.repo ? 'marketplace git remote' : null)
            });
        }
    }

    if (exists(marketplacesRoot)) {
        const files = walkFiles(marketplacesRoot, (relativePath) => relativePath.replace(/\\/g, '/') === '.claude-plugin/marketplace.json'
            || /\/\.claude-plugin\/marketplace\.json$/u.test(relativePath.replace(/\\/g, '/')));
        for (const file of files) {
            const normalized = file.relativePath.replace(/\\/g, '/');
            const registry = normalized.split('/')[0];
            if (!registry) {
                continue;
            }
            const dir = path.join(marketplacesRoot, registry);
            const existing = index.get(registry) || {
                registry,
                dir,
                repo: null,
                url: null,
                evidence: null
            };
            const gitInfo = readGitRemoteInfo(existing.dir || dir);
            index.set(registry, {
                ...existing,
                dir: existing.dir || dir,
                repo: existing.repo || gitInfo.repo || null,
                url: existing.url || gitInfo.url || null,
                evidence: mergeEvidence(existing.evidence, gitInfo.repo ? 'marketplace git remote' : null)
            });
        }
    }

    return index;
}

function buildClaudeInstalledPluginIndex(rootDir) {
    const index = new Map();
    const parsed = readJsonSafely(path.join(rootDir, '.claude', 'plugins', 'installed_plugins.json'));
    if (!parsed || !parsed.plugins || typeof parsed.plugins !== 'object' || Array.isArray(parsed.plugins)) {
        return index;
    }

    for (const [displayName, installs] of Object.entries(parsed.plugins)) {
        const identity = parsePluginIdentity(displayName);
        const install = Array.isArray(installs) ? installs[installs.length - 1] : installs;
        if (!install || typeof install !== 'object') {
            continue;
        }

        const sourceInfo = normalizeMarketplaceSource(install.source || install.repository || install.url || null, {});
        index.set(displayName, {
            name: identity.name,
            registry: identity.registry,
            version: install.version || null,
            url: sourceInfo.url || null,
            repo: sourceInfo.repo || null,
            sourcePath: sourceInfo.sourcePath || null,
            gitCommitSha: install.gitCommitSha || install.git_commit_sha || null,
            sourceType: sourceInfo.repo || sourceInfo.url ? 'github' : null,
            evidence: 'installed_plugins'
        });
    }

    return index;
}

function mergeClaudePluginIndexEntry(index, metadata) {
    if (!metadata || !metadata.name) {
        return;
    }
    const key = metadata.registry ? `${metadata.name}@${metadata.registry}` : metadata.name;
    const current = index.get(key) || {};
    index.set(key, mergeClaudePluginMetadata(current, metadata));
}

function mergeClaudePluginMetadata(current, next) {
    const repo = chooseSpecificRepo(current.repo, next.repo);
    const sourcePath = next.sourcePath || (next.repo && current.repo && next.repo !== current.repo ? null : current.sourcePath || null);
    const merged = {
        ...current,
        name: current.name || next.name,
        registry: current.registry || next.registry || null,
        version: next.version || current.version || null,
        repo,
        sourcePath,
        gitCommitSha: current.gitCommitSha || next.gitCommitSha || null,
        author: current.author || next.author || null,
        description: current.description || next.description || null,
        evidence: mergeEvidence(current.evidence, next.evidence)
    };
    merged.url = chooseSpecificUrl(current.url, next.url, merged.repo, merged.sourcePath, current.repo, next.repo);
    merged.sourceType = next.sourceType || current.sourceType || inferPluginSourceType(merged);
    merged.sourceType = inferPluginSourceType(merged);
    return merged;
}

function chooseSpecificRepo(currentRepo, nextRepo) {
    return nextRepo || currentRepo || null;
}

function chooseSpecificUrl(currentUrl, nextUrl, repo, sourcePath, currentRepo, nextRepo) {
    if (repo && sourcePath) {
        return githubTreeUrl(repo, sourcePath);
    }
    if (nextUrl && nextRepo && currentRepo && nextRepo !== currentRepo) {
        return nextUrl;
    }
    if (nextUrl && (!currentUrl || isMoreSpecificGithubUrl(nextUrl, currentUrl))) {
        return nextUrl;
    }
    if (currentUrl) {
        return currentUrl;
    }
    if (repo) {
        return githubRepoUrl(repo);
    }
    return null;
}

function isMoreSpecificGithubUrl(candidate, current) {
    if (!candidate || !current) {
        return Boolean(candidate);
    }
    if (!/github\.com/i.test(candidate) || !/github\.com/i.test(current)) {
        return candidate.length > current.length;
    }
    return candidate.length > current.length;
}

function normalizeMarketplaceSource(value, marketplaceMeta) {
    if (!value) {
        return {};
    }
    if (typeof value === 'object') {
        const direct = value.url || value.repository || value.repo || null;
        const nested = value.source && value.source !== 'github' && value.source !== 'url' && value.source !== 'git-subdir'
            ? value.source
            : direct;
        const sourcePath = normalizeSourcePath(value.path || value.subdir || value.sourcePath || null);
        const info = normalizeMarketplaceSource(nested || direct || null, marketplaceMeta);
        const repo = normalizeGithubRepo(value.repo || null) || info.repo || null;
        const url = normalizeRepositoryUrl(value.url || value.repository || null) || info.url || null;
        return {
            repo: repo || extractGithubRepo(url) || null,
            url: url || (repo ? githubRepoUrl(repo) : null),
            sourcePath: sourcePath || info.sourcePath || null
        };
    }

    const text = String(value).trim();
    if (text === '.' || text === './') {
        const repo = marketplaceMeta && marketplaceMeta.repo ? marketplaceMeta.repo : null;
        return {
            repo,
            url: repo ? githubRepoUrl(repo) : null,
            sourcePath: null
        };
    }
    const sourcePath = normalizeSourcePath(text);
    if (sourcePath) {
        const repo = marketplaceMeta && marketplaceMeta.repo ? marketplaceMeta.repo : null;
        return {
            repo,
            url: repo ? githubTreeUrl(repo, sourcePath) : null,
            sourcePath
        };
    }

    const repo = extractGithubRepo(text) || normalizeGithubRepo(text);
    const url = normalizeRepositoryUrl(text);
    return {
        repo: repo || null,
        url: url || (repo ? githubRepoUrl(repo) : null),
        sourcePath: null
    };
}

function normalizeSourcePath(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim().replace(/\\/g, '/');
    if (!text || /^[a-z]+:/iu.test(text) || /^git@/iu.test(text)) {
        return null;
    }
    if (!text.startsWith('.') && !text.includes('/')) {
        return null;
    }
    const normalized = text.replace(/^\.\//u, '').replace(/^\/+/u, '').replace(/\/+$/u, '');
    return normalized || null;
}

function readGitRemoteInfo(dirPath) {
    const configPath = path.join(dirPath, '.git', 'config');
    if (!exists(configPath)) {
        return {};
    }
    const content = readUtf8(configPath);
    const match = content.match(/^\s*url\s*=\s*(.+?)\s*$/imu);
    if (!match) {
        return {};
    }
    const url = normalizeRepositoryUrl(match[1]);
    return {
        url,
        repo: extractGithubRepo(url)
    };
}

function readJsonSafely(filePath) {
    if (!exists(filePath)) {
        return null;
    }
    try {
        return JSON.parse(readUtf8(filePath));
    } catch (error) {
        return null;
    }
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
        repo: normalizeGithubRepo(entry.repo || null) || extractGithubRepo(entry.url || null),
        sourcePath: entry.sourcePath || null,
        gitCommitSha: entry.gitCommitSha || null,
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
    if ((entry && entry.repo) || (url && /github\.com/i.test(url))) {
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
        return `https://github.com/${text.slice('github:'.length).replace(/\.git$/i, '')}`;
    }
    const repo = normalizeGithubRepo(text);
    if (repo) {
        return githubRepoUrl(repo);
    }
    return text.replace(/^git\+/i, '').replace(/\.git$/i, '');
}

function normalizeGithubRepo(value) {
    if (!value || typeof value !== 'string') {
        return null;
    }
    const text = value.trim().replace(/\.git$/i, '');
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text)) {
        return text;
    }
    return null;
}

function extractGithubRepo(value) {
    if (!value) {
        return null;
    }
    if (typeof value === 'object') {
        return extractGithubRepo(value.url || value.repository || value.repo || null);
    }
    const text = String(value).trim().replace(/^git\+/i, '').replace(/\.git$/i, '');
    const shorthand = normalizeGithubRepo(text);
    if (shorthand) {
        return shorthand;
    }
    const httpsMatch = text.match(/github\.com[:/]+([^/\s]+)\/([^/\s#?]+)/iu);
    if (httpsMatch) {
        return `${httpsMatch[1]}/${httpsMatch[2].replace(/\.git$/i, '')}`;
    }
    return null;
}

function githubRepoUrl(repo) {
    return repo ? `https://github.com/${repo}` : null;
}

function githubTreeUrl(repo, sourcePath) {
    if (!repo || !sourcePath) {
        return githubRepoUrl(repo);
    }
    return `${githubRepoUrl(repo)}/tree/main/${sourcePath}`;
}

function mergeEvidence(...values) {
    const parts = [];
    for (const value of values) {
        if (!value) {
            continue;
        }
        for (const part of String(value).split(/\s*\+\s*/u)) {
            if (part && !parts.includes(part)) {
                parts.push(part);
            }
        }
    }
    return parts.length > 0 ? parts.join(' + ') : null;
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
            repo: current.repo || entry.repo,
            sourcePath: current.sourcePath || entry.sourcePath,
            gitCommitSha: current.gitCommitSha || entry.gitCommitSha,
            author: current.author || entry.author,
            description: current.description || entry.description,
            sourceType: current.sourceType !== 'declared' ? current.sourceType : entry.sourceType,
            inferred: current.inferred && entry.inferred,
            evidence: mergeEvidence(current.evidence, entry.evidence)
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
