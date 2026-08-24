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
    const backend = getFsBackend();
    const stats = backend.lstatSync(sourcePath);
    rejectInvalidCopyTarget(backend, sourcePath, targetPath, stats);
    ensureDir(path.dirname(targetPath));
    copyPathEntry(sourcePath, targetPath, stats);
}

function rejectInvalidCopyTarget(backend, sourcePath, targetPath, stats) {
    const relativeTarget = path.relative(path.resolve(sourcePath), path.resolve(targetPath));
    if (!relativeTarget) {
        throwInvalidCopyTarget(sourcePath, targetPath);
    }
    let resolvedSource;
    try {
        resolvedSource = backend.realpathSync(sourcePath);
    } catch (error) {
        if (stats.isSymbolicLink() && isMissingEntryError(error)) {
            const resolvedSourceEntry = resolveWithExistingAncestor(backend, sourcePath);
            const resolvedTarget = resolveWithExistingAncestor(backend, targetPath);
            if (isSameOrNestedPath(resolvedTarget, resolvedSourceEntry)) {
                throwInvalidCopyTarget(sourcePath, targetPath);
            }
            return;
        }
        throw error;
    }
    const resolvedTarget = resolveWithExistingAncestor(backend, targetPath);
    if (!stats.isDirectory()) {
        if (resolvedSource === resolvedTarget) {
            throwInvalidCopyTarget(sourcePath, targetPath);
        }
        return;
    }
    if (!isParentTraversal(relativeTarget) && !path.isAbsolute(relativeTarget)) {
        throwInvalidCopyTarget(sourcePath, targetPath);
    }
    if (!isSameOrNestedPath(resolvedSource, resolvedTarget)) {
        return;
    }
    throwInvalidCopyTarget(sourcePath, targetPath);
}

function throwInvalidCopyTarget(sourcePath, targetPath) {
    const error = new TypeError(`Cannot copy ${sourcePath} to a subdirectory of self ${targetPath}`);
    error.code = 'ERR_FS_CP_EINVAL';
    throw error;
}

function resolveWithExistingAncestor(backend, targetPath) {
    let currentPath = path.resolve(targetPath);
    const missingParts = [];
    while (true) {
        try {
            return path.join(backend.realpathSync(currentPath), ...missingParts);
        } catch (error) {
            if (!isMissingEntryError(error)) {
                throw error;
            }
        }
        const parentPath = path.dirname(currentPath);
        if (parentPath === currentPath) {
            throw new Error(`ENOENT: no existing ancestor for ${targetPath}`);
        }
        missingParts.unshift(path.basename(currentPath));
        currentPath = parentPath;
    }
}

function copyPathEntry(sourcePath, targetPath, sourceStats) {
    const backend = getFsBackend();
    const stats = sourceStats || backend.lstatSync(sourcePath);
    const targetStats = getEntryStats(backend, targetPath);
    if (stats.isSymbolicLink()) {
        const rawLinkTarget = backend.readlinkSync(sourcePath);
        const linkTarget = path.isAbsolute(rawLinkTarget)
            ? rawLinkTarget
            : path.resolve(path.dirname(sourcePath), rawLinkTarget);
        let linkType = 'file';
        try {
            linkType = backend.statSync(sourcePath).isDirectory() ? 'junction' : 'file';
        } catch (error) {
            linkType = 'junction';
        }
        if (targetStats) {
            rejectContainedLinkTarget(backend, sourcePath, targetPath, linkTarget);
        }
        if (targetStats) {
            backend.rmSync(targetPath, { recursive: true, force: true });
        }
        backend.symlinkSync(linkTarget, targetPath, linkType);
        return;
    }
    if (stats.isDirectory()) {
        if (targetStats && targetStats.isSymbolicLink()) {
            backend.rmSync(targetPath, { recursive: true, force: true });
        }
        ensureDir(targetPath);
        for (const entry of backend.readdirSync(sourcePath)) {
            copyPathEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
        }
        backend.chmodSync(targetPath, stats.mode);
        return;
    }
    if (targetStats && !targetStats.isDirectory()) {
        backend.rmSync(targetPath, { recursive: true, force: true });
    }
    backend.copyFileSync(sourcePath, targetPath);
    backend.chmodSync(targetPath, stats.mode);
}

function getEntryStats(backend, targetPath) {
    try {
        return backend.lstatSync(targetPath);
    } catch (error) {
        if (isMissingEntryError(error)) {
            return null;
        }
        throw error;
    }
}

function isMissingEntryError(error) {
    return error.code === 'ENOENT' || String(error.message).startsWith('ENOENT:');
}

function isSameOrNestedPath(parentPath, candidatePath) {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(candidatePath));
    return !relativePath || (!isParentTraversal(relativePath) && !path.isAbsolute(relativePath));
}

function isParentTraversal(relativePath) {
    return relativePath === '..' || relativePath.startsWith(`..${path.sep}`);
}

function rejectContainedLinkTarget(backend, sourcePath, targetPath, fallbackLinkTarget) {
    let resolvedLinkTarget;
    try {
        resolvedLinkTarget = backend.realpathSync(sourcePath);
    } catch (error) {
        return;
    }
    const resolvedTarget = resolveWithExistingAncestor(backend, targetPath);
    if (isSameOrNestedPath(resolvedLinkTarget, resolvedTarget)
        || isSameOrNestedPath(resolvedTarget, resolvedLinkTarget)) {
        throwLinkTargetConflict(resolvedLinkTarget, resolvedTarget);
    }
}

function throwLinkTargetConflict(linkTarget, targetPath) {
    const error = new Error(`EEXIST: link target ${linkTarget} is inside destination ${targetPath}`);
    error.code = 'EEXIST';
    throw error;
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
