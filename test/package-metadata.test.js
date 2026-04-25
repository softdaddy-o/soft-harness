const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');

test('package metadata includes plugin wrappers and shared plugin content in published files', () => {
    const pkg = require(path.join('..', 'package.json'));
    assert.ok(pkg.files.includes('.agents'));
    assert.ok(pkg.files.includes('.claude-plugin'));
    assert.ok(pkg.files.includes('plugins'));
    assert.ok(pkg.files.includes('scripts'));
    assert.equal(pkg.bin['soft-harness'], 'src/cli.js');
});

test('plugin wrapper manifests and marketplaces are valid json', () => {
    const files = [
        '.claude-plugin/marketplace.json',
        '.agents/plugins/marketplace.json',
        'plugins/soft-harness/.claude-plugin/plugin.json',
        'plugins/soft-harness/.codex-plugin/plugin.json'
    ];

    for (const relativePath of files) {
        const absolutePath = path.join(__dirname, '..', relativePath);
        const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
        assert.equal(typeof parsed, 'object', relativePath);
    }
});

test('plugin wrapper versions stay aligned with the published package version', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const claudeMarketplace = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.claude-plugin', 'marketplace.json'), 'utf8'));
    const claudePlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.claude-plugin', 'plugin.json'), 'utf8'));
    const codexPlugin = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugins', 'soft-harness', '.codex-plugin', 'plugin.json'), 'utf8'));

    const publishedVersion = packageJson.version;
    const marketplaceEntry = claudeMarketplace.plugins.find((plugin) => plugin.name === 'soft-harness');

    assert.ok(marketplaceEntry);
    assert.equal(marketplaceEntry.version, publishedVersion);
    assert.equal(claudePlugin.version, publishedVersion);
    assert.equal(codexPlugin.version, publishedVersion);
});

test('package version bump automation keeps release-facing plugin metadata in sync', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

    assert.equal(packageJson.scripts.version, 'node scripts/sync-version.js');
});

test('plugin skill frontmatter is valid YAML for strict Codex loaders', () => {
    for (const skillPath of listPluginSkillFiles()) {
        const content = fs.readFileSync(skillPath, 'utf8');
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/u);

        assert.ok(match, `${path.relative(path.join(__dirname, '..'), skillPath)} is missing YAML frontmatter`);
        assert.doesNotThrow(() => YAML.parse(match[1]), path.relative(path.join(__dirname, '..'), skillPath));
    }
});

test('codex plugin skills stay usable when installer copies only SKILL.md files', () => {
    for (const skillPath of listPluginSkillFiles()) {
        const relativePath = path.relative(path.join(__dirname, '..'), skillPath);
        const content = fs.readFileSync(skillPath, 'utf8');

        assert.doesNotMatch(content, /\.\.\/references\//u, `${relativePath} depends on a sibling references directory`);
    }
});

function listPluginSkillFiles() {
    const skillsRoot = path.join(__dirname, '..', 'plugins', 'soft-harness', 'skills');
    return fs.readdirSync(skillsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(skillsRoot, entry.name, 'SKILL.md'))
        .filter((skillPath) => fs.existsSync(skillPath));
}
