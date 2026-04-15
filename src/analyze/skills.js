const path = require('node:path');
const { findAssetOrigin, loadAssetOrigins } = require('../asset-origins');
const { discoverSkillsAndAgents } = require('../skills');
const { exists, readUtf8 } = require('../fs-util');
const { listProfiles } = require('../profiles');
const { createFinding, similarity } = require('./shared');

function analyzeSkills(rootDir, options) {
    const findings = {
        common: [],
        similar: [],
        conflicts: [],
        hostOnly: [],
        unknown: []
    };
    const selectedLlms = (options && options.llms && options.llms.length > 0)
        ? options.llms
        : listProfiles();
    const llmFilter = new Set(selectedLlms);
    const discovered = discoverSkillsAndAgents(rootDir).filter((item) => llmFilter.size === 0 || llmFilter.has(item.llm));
    const assetOrigins = loadAssetOrigins(rootDir);
    const grouped = new Map();
    const inventoryMap = new Map();

    for (const llm of selectedLlms) {
        inventoryMap.set(llm, {
            llm,
            skills: [],
            agents: []
        });
    }

    for (const item of discovered) {
        inventoryMap.get(item.llm)[item.type === 'skill' ? 'skills' : 'agents'].push(item.name);
    }

    for (const item of discovered) {
        const key = `${item.type}:${item.name}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(item);
    }

    for (const members of grouped.values()) {
        if (members.length === 1) {
            findings.hostOnly.push(createFinding('hostOnly', {
                category: 'skills',
                kind: members[0].type,
                key: `skills.${members[0].type}.${members[0].name}`,
                sources: members.map((member) => createSkillSource(member)),
                reason: `${members[0].type} exists for only one host`
            }));
            continue;
        }

        const uniqueHashes = new Set(members.map((member) => member.hash));
        if (uniqueHashes.size === 1) {
            findings.common.push(createFinding('common', {
                category: 'skills',
                kind: members[0].type,
                key: `skills.${members[0].type}.${members[0].name}`,
                sources: members.map((member) => createSkillSource(member)),
                reason: `${members[0].type} content is identical across hosts`
            }));
            continue;
        }

        const score = calculateSkillSimilarity(members);
        const bucket = score >= 0.55 ? 'similar' : 'conflicts';
        findings[bucket].push(createFinding(bucket, {
            category: 'skills',
            kind: members[0].type,
            key: `skills.${members[0].type}.${members[0].name}`,
            sources: members.map((member) => createSkillSource(member)),
            reason: bucket === 'similar'
                ? `${members[0].type} shares a name but differs by host`
                : `${members[0].type} shares a name but content is incompatible`,
            score: bucket === 'similar' ? score : undefined
        }));
    }

    const inventory = Array.from(inventoryMap.values())
        .map((entry) => ({
            llm: entry.llm,
            skills: entry.skills.sort(),
            agents: entry.agents.sort()
        }))
        .sort((left, right) => left.llm.localeCompare(right.llm));

    return {
        findings,
        inventory,
        originsInventory: {
            llmPacket: buildSkillOriginPacket(rootDir, discovered, assetOrigins)
        }
    };
}

function calculateSkillSimilarity(members) {
    let best = 0;
    for (let index = 0; index < members.length; index += 1) {
        for (let inner = index + 1; inner < members.length; inner += 1) {
            best = Math.max(best, similarity(readComparableContent(members[index]), readComparableContent(members[inner])));
        }
    }
    return best;
}

function readComparableContent(member) {
    if (member.type === 'skill') {
        return readUtf8(path.join(member.absolutePath, 'SKILL.md'));
    }
    return readUtf8(member.absolutePath);
}

function createSkillSource(member) {
    return {
        llm: member.llm,
        file: member.relativePath,
        path: member.relativePath
    };
}

function buildSkillOriginPacket(rootDir, discovered, assetOrigins) {
    const assets = discovered
        .map((item) => buildSkillOriginEntry(rootDir, item, assetOrigins))
        .sort((left, right) => {
            const hostCompare = left.host.localeCompare(right.host);
            if (hostCompare !== 0) {
                return hostCompare;
            }
            const kindCompare = left.kind.localeCompare(right.kind);
            if (kindCompare !== 0) {
                return kindCompare;
            }
            return left.name.localeCompare(right.name);
        });

    return {
        schema_version: 1,
        instructions: [
            'Use local git metadata as confirmed evidence when repo and commit are present.',
            'Use web search for assets whose source_type is unknown or whose evidence is weak.',
            'Return only evidence-backed skill and agent origins; leave uncertain entries as unknown.'
        ],
        output_schema: {
            asset_origins: [{
                kind: '<skill|agent>',
                asset: '<name from packet>',
                hosts: ['<host from packet>'],
                source_type: '<github|marketplace|local|unknown>',
                repo: '<owner/repo or null>',
                url: '<canonical source URL or null>',
                source_path: '<path inside repo or null>',
                installed_version: '<installed version or null>',
                latest_version: '<latest version or null>',
                git_commit_sha: '<installed git commit or null>',
                confidence: '<confirmed|llm-inferred|unknown>',
                notes: '<short evidence-based rationale>'
            }]
        },
        assets
    };
}

function buildSkillOriginEntry(rootDir, item, assetOrigins) {
    const savedOrigin = findAssetOrigin(assetOrigins, item.llm, item.type, item.name);
    const localOrigin = detectLocalGitOrigin(rootDir, item);
    const origin = mergeOriginEvidence(savedOrigin, localOrigin);
    const sourceType = origin.sourceType || 'unknown';
    const repo = origin.repo || null;
    const url = origin.url || (repo ? githubRepoUrl(repo) : null);
    const gitCommitSha = origin.gitCommitSha || null;
    const confidence = origin.confidence || null;
    const evidence = [
        savedOrigin ? 'asset-origins.yaml' : null,
        localOrigin && localOrigin.evidence
    ].filter(Boolean).join(' + ') || null;

    const comparableContent = readComparableContent(item);
    return {
        id: `skills.${item.type}:${item.name}`,
        host: item.llm,
        kind: item.type,
        name: item.name,
        path: item.relativePath,
        source_type: sourceType,
        repo,
        url,
        source_path: origin.sourcePath || null,
        installed_version: origin.installedVersion || detectInstalledVersion(item) || null,
        latest_version: origin.latestVersion || null,
        git_commit_sha: gitCommitSha,
        confidence,
        evidence,
        notes: origin.notes || null,
        content_preview: createContentPreview(comparableContent),
        search_hints: buildSearchHints(item, comparableContent),
        needs_origin_research: !hasStrongOrigin(sourceType, repo, url, confidence, gitCommitSha)
    };
}

function mergeOriginEvidence(savedOrigin, localOrigin) {
    if (!savedOrigin && !localOrigin) {
        return {};
    }

    const savedIsStrong = savedOrigin && savedOrigin.sourceType && savedOrigin.sourceType !== 'unknown';
    return {
        sourceType: savedIsStrong ? savedOrigin.sourceType : (localOrigin && localOrigin.sourceType) || (savedOrigin && savedOrigin.sourceType) || null,
        repo: (savedOrigin && savedOrigin.repo) || (localOrigin && localOrigin.repo) || null,
        url: (savedOrigin && savedOrigin.url) || (localOrigin && localOrigin.url) || null,
        sourcePath: (savedOrigin && savedOrigin.sourcePath) || (localOrigin && localOrigin.sourcePath) || null,
        installedVersion: (savedOrigin && savedOrigin.installedVersion) || (localOrigin && localOrigin.installedVersion) || null,
        latestVersion: (savedOrigin && savedOrigin.latestVersion) || null,
        gitCommitSha: (localOrigin && localOrigin.gitCommitSha) || (savedOrigin && savedOrigin.gitCommitSha) || null,
        confidence: savedIsStrong ? savedOrigin.confidence : (localOrigin && localOrigin.confidence) || (savedOrigin && savedOrigin.confidence) || null,
        notes: (savedOrigin && savedOrigin.notes) || null
    };
}

function detectLocalGitOrigin(rootDir, item) {
    const gitRoot = findOwnedGitRoot(rootDir, item);
    if (!gitRoot) {
        return null;
    }

    const remote = readGitRemote(gitRoot);
    const commit = readGitHead(gitRoot);
    const repo = remote.repo || null;
    const url = remote.url || (repo ? githubRepoUrl(repo) : null);
    return {
        sourceType: repo || (url && /github\.com/iu.test(url)) ? 'github' : 'local',
        repo,
        url,
        sourcePath: toPosixRelativeOrDot(gitRoot, item.absolutePath),
        gitCommitSha: commit,
        confidence: repo && commit ? 'confirmed' : null,
        evidence: '.git remote origin'
    };
}

function findOwnedGitRoot(rootDir, item) {
    const normalizedRelative = item.relativePath.replace(/\\/g, '/');
    const parts = normalizedRelative.split('/');
    const boundary = item.type === 'skill'
        ? item.absolutePath
        : path.join(rootDir, parts[0], parts[1]);
    let current = item.type === 'skill' ? item.absolutePath : path.dirname(item.absolutePath);
    const stop = path.resolve(boundary);

    while (true) {
        if (exists(path.join(current, '.git', 'config'))) {
            return current;
        }
        if (path.resolve(current) === stop) {
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return null;
}

function readGitRemote(gitRoot) {
    const configPath = path.join(gitRoot, '.git', 'config');
    if (!exists(configPath)) {
        return {};
    }
    const content = readUtf8(configPath);
    const match = content.match(/^\s*url\s*=\s*(.+?)\s*$/imu);
    if (!match) {
        return {};
    }
    const url = normalizeRepositoryUrl(match[1]);
    const repo = extractGithubRepo(url);
    return {
        url,
        repo
    };
}

function readGitHead(gitRoot) {
    const headPath = path.join(gitRoot, '.git', 'HEAD');
    if (!exists(headPath)) {
        return null;
    }
    const head = readUtf8(headPath).trim();
    const refMatch = head.match(/^ref:\s*(.+)$/u);
    if (refMatch) {
        const refPath = path.join(gitRoot, '.git', refMatch[1]);
        return exists(refPath) ? normalizeGitSha(readUtf8(refPath)) : null;
    }
    return normalizeGitSha(head);
}

function normalizeGitSha(value) {
    const text = String(value || '').trim();
    return /^[a-f0-9]{7,40}$/iu.test(text) ? text : null;
}

function detectInstalledVersion(item) {
    if (item.type !== 'skill') {
        return null;
    }
    const versionPath = path.join(item.absolutePath, 'VERSION');
    if (exists(versionPath)) {
        const version = readUtf8(versionPath).trim();
        return version || null;
    }
    const packagePath = path.join(item.absolutePath, 'package.json');
    if (exists(packagePath)) {
        try {
            const parsed = JSON.parse(readUtf8(packagePath));
            return parsed && parsed.version ? String(parsed.version) : null;
        } catch (error) {
            return null;
        }
    }
    return null;
}

function createContentPreview(content) {
    return String(content || '').replace(/\s+/gu, ' ').trim().slice(0, 500) || null;
}

function buildSearchHints(item, content) {
    const hints = [
        quoteSearch(item.name)
    ];
    if (item.type === 'agent') {
        hints.push(quoteSearch(`${item.name}.md`));
    } else {
        hints.push(quoteSearch(`${item.name}/SKILL.md`));
    }

    const title = extractTitle(content);
    if (title && title.toLowerCase() !== item.name.toLowerCase()) {
        hints.push(quoteSearch(title));
    }

    const frontmatterName = extractFrontmatterName(content);
    if (frontmatterName && frontmatterName.toLowerCase() !== item.name.toLowerCase()) {
        hints.push(quoteSearch(frontmatterName));
    }

    const description = extractFrontmatterDescription(content);
    if (description) {
        hints.push(quoteSearch(description.slice(0, 120)));
    }

    hints.push(`${quoteSearch(item.name)} github`);
    hints.push(`${quoteSearch(item.name)} Claude Code ${item.type}`);

    return Array.from(new Set(hints.filter(Boolean))).slice(0, 8);
}

function quoteSearch(value) {
    const text = String(value || '').replace(/\s+/gu, ' ').trim();
    return text ? `"${text.replace(/"/gu, '\\"')}"` : null;
}

function extractTitle(content) {
    const match = String(content || '').match(/^#\s+(.+?)\s*$/mu);
    return match ? match[1].trim() : null;
}

function extractFrontmatterName(content) {
    const text = String(content || '');
    if (!text.startsWith('---')) {
        return null;
    }
    const match = text.match(/^name:\s*["']?(.+?)["']?\s*$/mu);
    return match ? match[1].trim() : null;
}

function extractFrontmatterDescription(content) {
    const text = String(content || '');
    if (!text.startsWith('---')) {
        return null;
    }
    const match = text.match(/^description:\s*["']?(.+?)["']?\s*$/mu);
    return match ? match[1].trim() : null;
}

function hasStrongOrigin(sourceType, repo, url, confidence, gitCommitSha) {
    if (sourceType === 'unknown') {
        return false;
    }
    if (confidence === 'confirmed') {
        return true;
    }
    if (repo && gitCommitSha) {
        return true;
    }
    return Boolean(url && sourceType !== 'unknown');
}

function toPosixRelativeOrDot(fromPath, toPath) {
    const relative = path.relative(fromPath, toPath).split(path.sep).join('/');
    return relative || '.';
}

function normalizeRepositoryUrl(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim();
    if (!text) {
        return null;
    }
    if (/^git@github\.com:/iu.test(text)) {
        return `https://github.com/${text.slice('git@github.com:'.length).replace(/\.git$/iu, '')}`;
    }
    if (/^github:/iu.test(text)) {
        return `https://github.com/${text.slice('github:'.length).replace(/\.git$/iu, '')}`;
    }
    const repo = normalizeGithubRepo(text);
    if (repo) {
        return githubRepoUrl(repo);
    }
    return text.replace(/^git\+/iu, '').replace(/\.git$/iu, '');
}

function normalizeGithubRepo(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim().replace(/\.git$/iu, '');
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(text)) {
        return text;
    }
    return null;
}

function extractGithubRepo(value) {
    if (!value) {
        return null;
    }
    const text = String(value).trim().replace(/^git\+/iu, '').replace(/\.git$/iu, '');
    const shorthand = normalizeGithubRepo(text);
    if (shorthand) {
        return shorthand;
    }
    const match = text.match(/github\.com[:/]+([^/\s]+)\/([^/\s#?]+)/iu);
    return match ? `${match[1]}/${match[2].replace(/\.git$/iu, '')}` : null;
}

function githubRepoUrl(repo) {
    return repo ? `https://github.com/${repo}` : null;
}

module.exports = {
    analyzeSkills
};
