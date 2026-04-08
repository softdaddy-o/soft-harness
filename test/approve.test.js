const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { discoverState } = require('../src/discover');
const { createMigrationProposal } = require('../src/migrate');
const { approveMigration } = require('../src/approve');
const { loadRegistry } = require('../src/registry');

test('approve promotes grouped migration proposals into registry.d', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-approve-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'migrate-project'), tempRoot, { recursive: true });
    const userHome = path.join(__dirname, 'fixtures', 'discovery-home');
    const discovery = discoverState(tempRoot, { userHome });
    const loaded = loadRegistry(tempRoot);
    const proposal = createMigrationProposal(tempRoot, discovery, loaded);

    const result = approveMigration(tempRoot, proposal.proposalDir);
    assert.equal(result.approvedFiles.length >= 1, true);
    assert.equal(result.approvedFiles.every((file) => fs.existsSync(file)), true);
});
