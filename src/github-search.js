const { similarity } = require('./analyze/shared');

const DEFAULT_GITHUB_SEARCH_THRESHOLD = 0.78;
const DEFAULT_GITHUB_SEARCH_LIMIT = 5;

async function resolveGithubCandidate(plugin, options) {
    const settings = options || {};
    if (!settings.resolveGithub) {
        return null;
    }

    if (typeof settings.githubSearch === 'function') {
        return normalizeCandidate(await settings.githubSearch(plugin));
    }

    if (plugin && plugin.url && /github\.com/i.test(String(plugin.url))) {
        return null;
    }

    return searchGithubRepositories(plugin, settings);
}

async function searchGithubRepositories(plugin, options) {
    if (typeof fetch !== 'function') {
        return null;
    }

    const requestUrl = buildGithubSearchUrl(plugin, options);
    const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'soft-harness'
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    if (process.env.GITHUB_API_VERSION) {
        headers['X-GitHub-Api-Version'] = process.env.GITHUB_API_VERSION;
    }

    let response;
    try {
        response = await fetch(requestUrl, { headers });
    } catch (error) {
        return null;
    }

    if (!response || !response.ok) {
        return null;
    }

    let payload;
    try {
        payload = await response.json();
    } catch (error) {
        return null;
    }

    const threshold = Number.isFinite(options && options.githubThreshold)
        ? options.githubThreshold
        : DEFAULT_GITHUB_SEARCH_THRESHOLD;
    const candidates = Array.isArray(payload && payload.items) ? payload.items : [];
    let best = null;
    for (const candidate of candidates) {
        const scored = scoreGithubRepositoryCandidate(plugin, candidate);
        if (!scored || scored.confidence < threshold) {
            continue;
        }
        if (!best || scored.confidence > best.confidence) {
            best = scored;
        }
    }
    return best;
}

function buildGithubSearchUrl(plugin, options) {
    const limit = Number.isFinite(options && options.githubSearchLimit)
        ? options.githubSearchLimit
        : DEFAULT_GITHUB_SEARCH_LIMIT;
    const query = buildGithubQuery(plugin);
    return `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars&order=desc`;
}

function buildGithubQuery(plugin) {
    const parts = [`"${plugin.name}" in:name`];
    const author = normalizeRepoToken(plugin.author || '');
    if (author) {
        parts.push(author);
    }
    return parts.join(' ');
}

function scoreGithubRepositoryCandidate(plugin, repository) {
    if (!repository || !repository.name || !repository.full_name || !repository.html_url) {
        return null;
    }

    const pluginName = normalizeRepoToken(plugin && plugin.name);
    const repoName = normalizeRepoToken(repository.name);
    const repoOwner = normalizeRepoToken(repository.owner && repository.owner.login);
    const pluginAuthor = normalizeRepoToken(plugin && plugin.author);
    const pluginDescription = normalizeRepoText(plugin && plugin.description);
    const repoDescription = normalizeRepoText(repository.description);

    let confidence = 0;
    const reasons = [];

    if (pluginName && repoName) {
        if (pluginName === repoName) {
            confidence += 0.72;
            reasons.push('exact repository name');
        } else {
            const nameScore = similarity(pluginName, repoName);
            confidence += nameScore * 0.52;
            if (nameScore >= 0.8) {
                reasons.push('similar repository name');
            }
        }
    }

    if (pluginAuthor && repoOwner) {
        if (pluginAuthor === repoOwner) {
            confidence += 0.18;
            reasons.push('plugin author matches owner');
        } else {
            const authorScore = similarity(pluginAuthor, repoOwner);
            confidence += authorScore * 0.08;
            if (authorScore >= 0.75) {
                reasons.push('plugin author resembles owner');
            }
        }
    }

    if (pluginDescription && repoDescription) {
        const descriptionScore = similarity(pluginDescription, repoDescription);
        confidence += descriptionScore * 0.15;
        if (descriptionScore >= 0.7) {
            reasons.push('description similarity');
        }
    }

    confidence = Math.max(0, Math.min(1, confidence));
    if (confidence <= 0) {
        return null;
    }

    const reason = reasons.length > 0
        ? `matched by ${reasons.join(' and ')}`
        : 'matched by repository search ranking';

    return normalizeCandidate({
        fullName: repository.full_name,
        url: repository.html_url,
        confidence,
        reason
    });
}

function normalizeCandidate(candidate) {
    if (!candidate || !candidate.fullName || !candidate.url) {
        return null;
    }
    return {
        fullName: String(candidate.fullName),
        url: String(candidate.url),
        confidence: Number.isFinite(candidate.confidence) ? candidate.confidence : null,
        reason: candidate.reason ? String(candidate.reason) : 'matched by repository search ranking'
    };
}

function normalizeRepoToken(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeRepoText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

module.exports = {
    DEFAULT_GITHUB_SEARCH_LIMIT,
    DEFAULT_GITHUB_SEARCH_THRESHOLD,
    __private: {
        buildGithubQuery,
        buildGithubSearchUrl,
        normalizeCandidate,
        normalizeRepoText,
        normalizeRepoToken,
        scoreGithubRepositoryCandidate
    },
    resolveGithubCandidate
};
