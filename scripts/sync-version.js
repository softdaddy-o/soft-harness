const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

function readJson(relativePath) {
    return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function writeJson(relativePath, value) {
    fs.writeFileSync(path.join(rootDir, relativePath), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function main() {
    const pkg = readJson('package.json');
    const version = String(pkg.version || '').trim();
    if (!version) {
        throw new Error('package.json version is missing');
    }

    const lock = readJson('package-lock.json');
    lock.version = version;
    if (lock.packages && lock.packages['']) {
        lock.packages[''].version = version;
    }
    writeJson('package-lock.json', lock);

    const marketplace = readJson('.claude-plugin/marketplace.json');
    let matchedMarketplacePlugin = false;
    marketplace.plugins = (marketplace.plugins || []).map((plugin) => {
        if (plugin && plugin.name === pkg.name) {
            matchedMarketplacePlugin = true;
            return {
                ...plugin,
                version
            };
        }
        return plugin;
    });
    if (!matchedMarketplacePlugin) {
        throw new Error(`.claude-plugin/marketplace.json is missing plugin entry for ${pkg.name}`);
    }
    writeJson('.claude-plugin/marketplace.json', marketplace);

    for (const relativePath of [
        'plugins/soft-harness/.claude-plugin/plugin.json',
        'plugins/soft-harness/.codex-plugin/plugin.json'
    ]) {
        const manifest = readJson(relativePath);
        manifest.version = version;
        writeJson(relativePath, manifest);
    }
}

main();
