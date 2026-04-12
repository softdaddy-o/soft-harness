const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function copyDir(sourceDir, targetDir) {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDir(sourcePath, targetPath);
            continue;
        }
        fs.copyFileSync(sourcePath, targetPath);
    }
}

function copyFixture(name) {
    const sourceDir = path.join(__dirname, 'fixtures', name);
    const targetDir = makeTempDir(`soft-harness-${name}-`);
    copyDir(sourceDir, targetDir);
    return targetDir;
}

function writeTree(rootDir, tree, currentDir) {
    const baseDir = currentDir || rootDir;
    for (const [name, value] of Object.entries(tree || {})) {
        const targetPath = path.join(baseDir, name);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            fs.mkdirSync(targetPath, { recursive: true });
            writeTree(rootDir, value, targetPath);
            continue;
        }

        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, value === undefined || value === null ? '' : String(value), 'utf8');
    }
}

function makeProjectTree(prefix, tree) {
    const rootDir = makeTempDir(prefix);
    writeTree(rootDir, tree);
    return rootDir;
}

function runGit(rootDir, args) {
    const result = spawnSync('git', args, {
        cwd: rootDir,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
    }
    return result;
}

function initGitRepo(rootDir) {
    runGit(rootDir, ['init']);
    runGit(rootDir, ['config', 'user.email', 'tests@example.com']);
    runGit(rootDir, ['config', 'user.name', 'Soft Harness Tests']);
}

function loadFresh(modulePath) {
    const resolved = require.resolve(modulePath);
    delete require.cache[resolved];
    return require(resolved);
}

module.exports = {
    copyFixture,
    initGitRepo,
    loadFresh,
    makeProjectTree,
    makeTempDir,
    runGit,
    writeTree
};
