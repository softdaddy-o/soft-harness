const path = require('node:path');
const { withFsBackend } = require('../src/fs-backend');

function createMemoryFs() {
    const entries = new Map();
    let clock = 1;

    const backend = {
        cpSync,
        existsSync,
        lstatSync,
        mkdirSync,
        readFileSync,
        readdirSync,
        readlinkSync,
        rmSync,
        statSync,
        symlinkSync,
        writeFileSync
    };

    return {
        backend,
        root(name) {
            const rootPath = path.resolve(name || `memory-fs-${clock}`);
            mkdirSync(rootPath, { recursive: true });
            return rootPath;
        },
        run(callback) {
            return withFsBackend(backend, callback);
        },
        writeTree(rootDir, tree, currentDir) {
            const baseDir = currentDir || rootDir;
            for (const [name, value] of Object.entries(tree || {})) {
                const targetPath = path.join(baseDir, name);
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    mkdirSync(targetPath, { recursive: true });
                    this.writeTree(rootDir, value, targetPath);
                    continue;
                }
                writeFileSync(targetPath, value === undefined || value === null ? '' : String(value), 'utf8');
            }
        }
    };

    function normalize(targetPath) {
        return path.resolve(targetPath);
    }

    function touch(node) {
        node.mtimeMs = clock;
        clock += 1;
    }

    function ensureDirectoryEntry(dirPath) {
        const absolutePath = normalize(dirPath);
        if (entries.has(absolutePath)) {
            const current = entries.get(absolutePath);
            if (current.type !== 'dir') {
                throw new Error(`not a directory: ${absolutePath}`);
            }
            return current;
        }

        const parent = path.dirname(absolutePath);
        if (parent !== absolutePath) {
            ensureDirectoryEntry(parent);
        }

        const node = { type: 'dir', mtimeMs: 0 };
        touch(node);
        entries.set(absolutePath, node);
        return node;
    }

    function getEntry(targetPath, options) {
        const settings = options || {};
        const absolutePath = normalize(targetPath);
        const entry = entries.get(absolutePath);
        if (!entry) {
            throw new Error(`ENOENT: no such file or directory, ${absolutePath}`);
        }

        if (!settings.followSymlinks || entry.type !== 'symlink') {
            return {
                path: absolutePath,
                entry
            };
        }

        const visited = settings.visited || new Set();
        if (visited.has(absolutePath)) {
            throw new Error(`ELOOP: too many symbolic links, ${absolutePath}`);
        }
        visited.add(absolutePath);
        const resolvedTarget = path.isAbsolute(entry.target)
            ? entry.target
            : path.resolve(path.dirname(absolutePath), entry.target);
        return getEntry(resolvedTarget, {
            ...settings,
            visited
        });
    }

    function makeStats(entry) {
        return {
            mtimeMs: entry.mtimeMs,
            isDirectory() {
                return entry.type === 'dir';
            },
            isFile() {
                return entry.type === 'file';
            },
            isSymbolicLink() {
                return entry.type === 'symlink';
            }
        };
    }

    function makeDirent(name, entry) {
        return {
            name,
            isDirectory() {
                return entry.type === 'dir';
            },
            isFile() {
                return entry.type === 'file';
            },
            isSymbolicLink() {
                return entry.type === 'symlink';
            }
        };
    }

    function mkdirSync(dirPath) {
        ensureDirectoryEntry(dirPath);
    }

    function existsSync(targetPath) {
        return entries.has(normalize(targetPath));
    }

    function writeFileSync(filePath, content) {
        const absolutePath = normalize(filePath);
        ensureDirectoryEntry(path.dirname(absolutePath));
        const node = {
            type: 'file',
            content: String(content),
            mtimeMs: 0
        };
        touch(node);
        entries.set(absolutePath, node);
    }

    function readFileSync(filePath) {
        const resolved = getEntry(filePath, { followSymlinks: true });
        if (resolved.entry.type !== 'file') {
            throw new Error(`EISDIR: illegal operation on directory, read ${resolved.path}`);
        }
        return resolved.entry.content;
    }

    function statSync(targetPath) {
        return makeStats(getEntry(targetPath, { followSymlinks: true }).entry);
    }

    function lstatSync(targetPath) {
        return makeStats(getEntry(targetPath, { followSymlinks: false }).entry);
    }

    function readlinkSync(targetPath) {
        const resolved = getEntry(targetPath, { followSymlinks: false });
        if (resolved.entry.type !== 'symlink') {
            throw new Error(`EINVAL: invalid argument, readlink ${resolved.path}`);
        }
        return resolved.entry.target;
    }

    function symlinkSync(target, linkPath, type) {
        const absolutePath = normalize(linkPath);
        ensureDirectoryEntry(path.dirname(absolutePath));
        const node = {
            type: 'symlink',
            target,
            linkType: type,
            mtimeMs: 0
        };
        touch(node);
        entries.set(absolutePath, node);
    }

    function readdirSync(dirPath, options) {
        const absolutePath = normalize(dirPath);
        const resolved = getEntry(absolutePath, { followSymlinks: true });
        if (resolved.entry.type !== 'dir') {
            throw new Error(`ENOTDIR: not a directory, scandir ${absolutePath}`);
        }

        const children = [];
        for (const [entryPath, entry] of entries.entries()) {
            if (entryPath === absolutePath) {
                continue;
            }
            if (path.dirname(entryPath) !== absolutePath) {
                continue;
            }
            children.push({ name: path.basename(entryPath), entry });
        }
        children.sort((left, right) => left.name.localeCompare(right.name));
        if (options && options.withFileTypes) {
            return children.map((child) => makeDirent(child.name, child.entry));
        }
        return children.map((child) => child.name);
    }

    function rmSync(targetPath, options) {
        const absolutePath = normalize(targetPath);
        if (!entries.has(absolutePath)) {
            if (options && options.force) {
                return;
            }
            throw new Error(`ENOENT: no such file or directory, ${absolutePath}`);
        }

        for (const entryPath of Array.from(entries.keys())) {
            if (entryPath === absolutePath || entryPath.startsWith(`${absolutePath}${path.sep}`)) {
                entries.delete(entryPath);
            }
        }
    }

    function cpSync(sourcePath, targetPath) {
        const absoluteSource = normalize(sourcePath);
        const absoluteTarget = normalize(targetPath);
        const source = getEntry(absoluteSource, { followSymlinks: false });
        ensureDirectoryEntry(path.dirname(absoluteTarget));

        if (source.entry.type === 'file') {
            writeFileSync(absoluteTarget, source.entry.content);
            return;
        }

        if (source.entry.type === 'symlink') {
            symlinkSync(source.entry.target, absoluteTarget, source.entry.linkType || 'file');
            return;
        }

        ensureDirectoryEntry(absoluteTarget);
        for (const entryPath of Array.from(entries.keys()).sort()) {
            if (!entryPath.startsWith(`${absoluteSource}${path.sep}`)) {
                continue;
            }
            const relativePath = path.relative(absoluteSource, entryPath);
            const destination = path.join(absoluteTarget, relativePath);
            const current = entries.get(entryPath);
            if (current.type === 'dir') {
                ensureDirectoryEntry(destination);
            } else if (current.type === 'file') {
                writeFileSync(destination, current.content);
            } else {
                symlinkSync(current.target, destination, current.linkType || 'file');
            }
        }
    }
}

module.exports = {
    createMemoryFs
};
