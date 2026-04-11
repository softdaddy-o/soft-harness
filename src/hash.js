const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalize(content) {
    return String(content || '').replace(/\r\n/g, '\n');
}

function hashString(content) {
    return crypto.createHash('sha256').update(normalize(content)).digest('hex');
}

function hashFile(filePath) {
    return hashString(fs.readFileSync(filePath, 'utf8'));
}

function hashDirectory(dirPath, options) {
    const ignore = new Set((options && options.ignore) || []);
    const entries = [];
    walk(dirPath, '', entries, ignore);
    entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

    const hasher = crypto.createHash('sha256');
    for (const entry of entries) {
        hasher.update(entry.relativePath);
        hasher.update('\0');
        hasher.update(entry.hash);
        hasher.update('\0');
    }

    return hasher.digest('hex');
}

function walk(rootDir, relativeDir, entries, ignore) {
    const currentDir = relativeDir ? path.join(rootDir, relativeDir) : rootDir;
    const items = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const item of items) {
        if (ignore.has(item.name)) {
            continue;
        }

        const relativePath = relativeDir ? `${relativeDir}/${item.name}` : item.name;
        const absolutePath = path.join(rootDir, relativePath);
        if (item.isDirectory()) {
            walk(rootDir, relativePath, entries, ignore);
            continue;
        }

        if (item.isFile()) {
            entries.push({
                relativePath,
                hash: hashFile(absolutePath)
            });
        }
    }
}

module.exports = {
    hashDirectory,
    hashFile,
    hashString
};
