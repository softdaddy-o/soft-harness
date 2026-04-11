const fs = require('node:fs');
const path = require('node:path');
const { ensureDir, exists, removePath } = require('./fs-util');

function createLink(sourcePath, targetPath) {
    ensureDir(path.dirname(targetPath));
    removePath(targetPath);

    try {
        fs.symlinkSync(sourcePath, targetPath, 'junction');
        return { mode: process.platform === 'win32' ? 'junction' : 'symlink' };
    } catch (firstError) {
        try {
            fs.symlinkSync(sourcePath, targetPath);
            return { mode: 'symlink' };
        } catch (secondError) {
            return {
                mode: 'copy',
                error: secondError.message || firstError.message
            };
        }
    }
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
