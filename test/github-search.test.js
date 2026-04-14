const test = require('node:test');
const assert = require('node:assert/strict');
const { __private, resolveGithubCandidate } = require('../src/github-search');

test('github-search: builds stable queries and scores strong exact matches highest', () => {
    const plugin = {
        name: 'frontend-design',
        author: 'acme',
        description: 'Frontend design system helper'
    };

    assert.match(__private.buildGithubQuery(plugin), /"frontend-design" in:name/);

    const exact = __private.scoreGithubRepositoryCandidate(plugin, {
        name: 'frontend-design',
        full_name: 'acme/frontend-design',
        html_url: 'https://github.com/acme/frontend-design',
        description: 'Frontend design system helper',
        owner: { login: 'acme' }
    });
    const weak = __private.scoreGithubRepositoryCandidate(plugin, {
        name: 'another-tool',
        full_name: 'other/another-tool',
        html_url: 'https://github.com/other/another-tool',
        description: 'Unrelated repository',
        owner: { login: 'other' }
    });

    assert.equal(exact.fullName, 'acme/frontend-design');
    assert.ok(exact.confidence > weak.confidence);
});

test('github-search: resolveGithubCandidate uses injected search and normalizes the candidate', async () => {
    const candidate = await resolveGithubCandidate({
        name: 'frontend-design',
        displayName: 'frontend-design@claude-code-plugins'
    }, {
        resolveGithub: true,
        githubSearch: async () => ({
            fullName: 'acme/frontend-design',
            url: 'https://github.com/acme/frontend-design',
            confidence: 0.84,
            reason: 'matched by exact repository name'
        })
    });

    assert.deepEqual(candidate, {
        fullName: 'acme/frontend-design',
        url: 'https://github.com/acme/frontend-design',
        confidence: 0.84,
        reason: 'matched by exact repository name'
    });
});
