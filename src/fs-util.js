const fs = require('fs');
const path = require('path');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readUtf8(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
    writeUtf8(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function exists(filePath) {
    return fs.existsSync(filePath);
}

function toPosixRelative(fromPath, toPath) {
    return path.relative(fromPath, toPath).split(path.sep).join('/');
}

function resolveTemplatePath(templatePath, variables, baseDir) {
    let resolved = String(templatePath);
    for (const [key, value] of Object.entries(variables || {})) {
        resolved = resolved.replaceAll(`{${key}}`, value);
    }
    if (path.isAbsolute(resolved)) {
        return path.resolve(resolved);
    }
    return path.resolve(baseDir || process.cwd(), resolved);
}

module.exports = {
    ensureDir,
    exists,
    readUtf8,
    resolveTemplatePath,
    toPosixRelative,
    writeJson,
    writeUtf8
};
