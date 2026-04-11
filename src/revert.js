const { restoreBackup } = require('./backup');

function runRevert(rootDir, options) {
    if (!options || !options.timestamp) {
        throw new Error('timestamp is required');
    }
    return restoreBackup(rootDir, options.timestamp);
}

module.exports = {
    runRevert
};
