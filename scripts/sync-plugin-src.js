#!/usr/bin/env node
// Copies the CLI's runtime module graph into the plugin, so installing the
// plugin is the only step a user needs. Nothing here may pull in a
// node_modules dependency: the plugin cache is a plain copied directory.
//
//   node scripts/sync-plugin-src.js          # write
//   node scripts/sync-plugin-src.js --check  # exit 1 if out of date

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE_DIR = path.join(REPO_ROOT, 'src');
const PLUGIN_SRC_DIR = path.join(REPO_ROOT, 'plugins', 'soft-harness', 'src');
const ENTRY = path.join(SOURCE_DIR, 'cli.js');

// Every module reachable from the CLI entry point by a relative require.
// Anything unreachable (the eval tooling, which legitimately still uses the
// `yaml` package) is deliberately left out of the bundle.
function collectRuntimeGraph() {
    const seen = new Set();
    const queue = [ENTRY];
    const external = new Map();

    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);

        const source = fs.readFileSync(file, 'utf8');
        const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const request = match[1];
            if (request.startsWith('node:')) {
                continue;
            }
            if (!request.startsWith('.')) {
                if (!external.has(request)) {
                    external.set(request, []);
                }
                external.get(request).push(path.relative(REPO_ROOT, file));
                continue;
            }
            let resolved = path.resolve(path.dirname(file), request);
            if (!resolved.endsWith('.js')) {
                resolved += '.js';
            }
            if (fs.existsSync(resolved)) {
                queue.push(resolved);
            }
        }
    }

    if (external.size > 0) {
        throw new Error(
            `the runtime graph requires third-party modules, which cannot be bundled: ${
                JSON.stringify([...external.entries()])}`
        );
    }

    return [...seen].sort();
}

function relativeName(file) {
    return path.relative(SOURCE_DIR, file).split(path.sep).join('/');
}

function main() {
    const check = process.argv.includes('--check');
    const files = collectRuntimeGraph();
    const expected = new Map(files.map((file) => [relativeName(file), fs.readFileSync(file, 'utf8')]));

    const stale = [];
    for (const [name, content] of expected) {
        const target = path.join(PLUGIN_SRC_DIR, name);
        const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
        if (current !== content) {
            stale.push(name);
            if (!check) {
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, content, 'utf8');
            }
        }
    }

    const extra = [];
    if (fs.existsSync(PLUGIN_SRC_DIR)) {
        const walk = (dir) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    walk(full);
                    continue;
                }
                const name = path.relative(PLUGIN_SRC_DIR, full).split(path.sep).join('/');
                if (!expected.has(name)) {
                    extra.push(name);
                    if (!check) {
                        fs.rmSync(full);
                    }
                }
            }
        };
        walk(PLUGIN_SRC_DIR);
    }

    if (check) {
        if (stale.length > 0 || extra.length > 0) {
            console.error('plugin src is out of date. Run: node scripts/sync-plugin-src.js');
            for (const name of stale) {
                console.error(`  stale: ${name}`);
            }
            for (const name of extra) {
                console.error(`  extra: ${name}`);
            }
            process.exit(1);
        }
        console.log(`plugin src is in sync (${expected.size} files)`);
        return;
    }

    console.log(`synced ${expected.size} files into plugins/soft-harness/src`);
    for (const name of stale) {
        console.log(`  updated: ${name}`);
    }
    for (const name of extra) {
        console.log(`  removed: ${name}`);
    }
}

main();
