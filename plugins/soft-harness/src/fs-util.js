const path = require('node:path');
const { getFsBackend } = require('./fs-backend');

function ensureDir(dirPath) {
    getFsBackend().mkdirSync(dirPath, { recursive: true });
}

function exists(filePath) {
    return getFsBackend().existsSync(filePath);
}

function isFile(filePath) {
    return exists(filePath) && getFsBackend().statSync(filePath).isFile();
}

function isDirectory(filePath) {
    return exists(filePath) && getFsBackend().statSync(filePath).isDirectory();
}

function readUtf8(filePath) {
    return getFsBackend().readFileSync(filePath, 'utf8');
}

function writeUtf8(filePath, content) {
    ensureDir(path.dirname(filePath));
    getFsBackend().writeFileSync(filePath, content, 'utf8');
}

function readJson(filePath, fallback) {
    if (!exists(filePath)) {
        return fallback;
    }
    return JSON.parse(readUtf8(filePath));
}

function writeJson(filePath, value) {
    writeUtf8(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function copyPath(sourcePath, targetPath) {
    ensureDir(path.dirname(targetPath));
    getFsBackend().cpSync(sourcePath, targetPath, {
        recursive: true,
        force: true
    });
}

function removePath(targetPath) {
    if (exists(targetPath)) {
        getFsBackend().rmSync(targetPath, { recursive: true, force: true });
    }
}

function getMtime(filePath) {
    if (!exists(filePath)) {
        return 0;
    }
    return getFsBackend().statSync(filePath).mtimeMs;
}

function toPosixRelative(fromPath, toPath) {
    return path.relative(fromPath, toPath).split(path.sep).join('/');
}

function kstTimestamp(date) {
    const current = date || new Date();
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const hours = String(current.getHours()).padStart(2, '0');
    const minutes = String(current.getMinutes()).padStart(2, '0');
    const seconds = String(current.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

function formatOffsetDate(date) {
    const current = date || new Date();
    const offsetMinutes = -current.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const absMinutes = Math.abs(offsetMinutes);
    const hours = String(Math.floor(absMinutes / 60)).padStart(2, '0');
    const minutes = String(absMinutes % 60).padStart(2, '0');
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const hour = String(current.getHours()).padStart(2, '0');
    const minute = String(current.getMinutes()).padStart(2, '0');
    const second = String(current.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}T${hour}:${minute}:${second}${sign}${hours}:${minutes}`;
}

function walkFiles(rootDir, predicate) {
    const results = [];
    if (!exists(rootDir)) {
        return results;
    }

    walkInto(rootDir, '', results, predicate);
    return results;
}

function walkInto(rootDir, relativeDir, results, predicate) {
    const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    const items = getFsBackend().readdirSync(currentDir, { withFileTypes: true });

    for (const item of items) {
        const relativePath = relativeDir ? path.posix.join(relativeDir, item.name) : item.name;
        const absolutePath = path.join(rootDir, relativePath);
        if (item.isDirectory()) {
            walkInto(rootDir, relativePath, results, predicate);
            continue;
        }
        if (!predicate || predicate(relativePath, absolutePath, item)) {
            results.push({
                relativePath,
                absolutePath
            });
        }
    }
}

module.exports = {
    copyPath,
    ensureDir,
    exists,
    formatOffsetDate,
    getMtime,
    isDirectory,
    isFile,
    kstTimestamp,
    readJson,
    readUtf8,
    removePath,
    toPosixRelative,
    walkFiles,
    writeJson,
    writeUtf8
};
