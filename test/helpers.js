const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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

module.exports = {
    copyFixture,
    makeTempDir
};
