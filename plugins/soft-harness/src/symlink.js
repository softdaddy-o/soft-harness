const fs = require('node:fs');
const path = require('node:path');
const { ensureDir, exists, removePath } = require('./fs-util');

function createLink(sourcePath, targetPath, options) {
    const settings = options || {};
    const prefer = settings.prefer || 'symlink';
    if (prefer === 'copy') {
        return { mode: 'copy', reason: 'copy-preferred' };
    }

    ensureDir(path.dirname(targetPath));
    removePath(targetPath);

    const linkType = detectLinkType(sourcePath);

    try {
        fs.symlinkSync(sourcePath, targetPath, linkType === 'dir' ? 'dir' : 'file');
        return { mode: 'symlink' };
    } catch (firstError) {
        if (process.platform === 'win32' && linkType === 'dir' && prefer === 'junction') {
            try {
                fs.symlinkSync(sourcePath, targetPath, 'junction');
                return { mode: 'junction' };
            } catch (secondError) {
                return {
                    mode: 'copy',
                    error: secondError.message || firstError.message
                };
            }
        }

        return {
            mode: 'copy',
            error: firstError.message
        };
    }
}

function detectLinkType(sourcePath) {
    if (!exists(sourcePath)) {
        return 'dir';
    }

    return fs.lstatSync(sourcePath).isDirectory() ? 'dir' : 'file';
}

function isSymlink(targetPath) {
    return exists(targetPath) && fs.lstatSync(targetPath).isSymbolicLink();
}

function readLink(targetPath) {
    return fs.readlinkSync(targetPath);
}

module.exports = {
    createLink,
    isSymlink,
    readLink
};
