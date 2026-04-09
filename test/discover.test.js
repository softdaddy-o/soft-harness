const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { discoverState } = require('../src/discover');

const fixturesRoot = path.join(__dirname, 'fixtures');

test('discovers project and account assets from fixture roots', () => {
    const projectRoot = path.join(fixturesRoot, 'discovery-project');
    const userHome = path.join(fixturesRoot, 'discovery-home');
    const discovery = discoverState(projectRoot, { scope: 'project', userHome });
    const accountDiscovery = discoverState(projectRoot, { scope: 'account', userHome });

    const projectPaths = discovery.assets
        .filter((asset) => asset.scope === 'project')
        .map((asset) => asset.relativePath.replace(/\\/g, '/'));

    assert.equal(projectPaths.includes('AGENTS.md'), true);
    assert.equal(projectPaths.includes('CLAUDE.md'), true);
    assert.equal(projectPaths.includes('.claude/CLAUDE.md'), true);
    assert.equal(projectPaths.includes('.mcp.json'), true);
    assert.equal(projectPaths.includes('.claude/skills/project-claude-skill/SKILL.md'), true);
    assert.equal(discovery.assets.some((asset) => asset.scope === 'account'), false);
    assert.equal(accountDiscovery.assets.some((asset) => asset.type === 'plugin' && asset.scope === 'account'), true);
    assert.equal(accountDiscovery.assets.some((asset) => asset.type === 'skill' && asset.target === 'codex' && asset.scope === 'account'), true);
});
