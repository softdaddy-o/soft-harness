const fs = require('fs');
const path = require('path');
const { ensureDir, exists, readUtf8, writeUtf8 } = require('./fs-util');

function approveMigration(rootDir, proposalDir) {
    const targetDir = path.join(rootDir, 'harness', 'registry.d');
    const sourceDir = proposalDir || path.join(targetDir, 'discovered');
    if (!exists(sourceDir)) {
        throw new Error(`Proposal directory not found: ${sourceDir}`);
    }

    const summaryPath = path.join(sourceDir, 'summary.json');
    if (!exists(summaryPath)) {
        throw new Error(`Proposal summary not found: ${summaryPath}`);
    }

    const summary = JSON.parse(readUtf8(summaryPath));
    const approved = [];

    for (const proposalFile of summary.proposalFiles || []) {
        const sourcePath = path.resolve(proposalFile);
        const fileName = path.basename(sourcePath);
        const targetPath = path.join(targetDir, `approved-${fileName}`);
        writeUtf8(targetPath, readUtf8(sourcePath));
        approved.push(targetPath);
    }

    return {
        proposalDir: sourceDir,
        approvedFiles: approved,
        summaryPath
    };
}

module.exports = {
    approveMigration
};
