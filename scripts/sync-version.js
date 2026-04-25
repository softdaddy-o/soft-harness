const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const packageJsonPath = path.join(repoRoot, 'package.json');

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function syncVersion() {
    const packageJson = readJson(packageJsonPath);
    const version = packageJson.version;
    if (!version) {
        throw new Error('package.json is missing version');
    }

    const claudeMarketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
    const claudePluginPath = path.join(repoRoot, 'plugins', 'soft-harness', '.claude-plugin', 'plugin.json');
    const codexPluginPath = path.join(repoRoot, 'plugins', 'soft-harness', '.codex-plugin', 'plugin.json');

    const claudeMarketplace = readJson(claudeMarketplacePath);
    const claudeMarketplaceEntry = Array.isArray(claudeMarketplace.plugins)
        ? claudeMarketplace.plugins.find((plugin) => plugin.name === 'soft-harness')
        : null;
    if (!claudeMarketplaceEntry) {
        throw new Error('soft-harness marketplace entry not found in .claude-plugin/marketplace.json');
    }
    claudeMarketplaceEntry.version = version;
    writeJson(claudeMarketplacePath, claudeMarketplace);

    const claudePlugin = readJson(claudePluginPath);
    claudePlugin.version = version;
    writeJson(claudePluginPath, claudePlugin);

    const codexPlugin = readJson(codexPluginPath);
    codexPlugin.version = version;
    writeJson(codexPluginPath, codexPlugin);

    process.stdout.write(`synced release-facing plugin versions to ${version}\n`);
}

if (require.main === module) {
    syncVersion();
}

module.exports = {
    syncVersion
};
