const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverState } = require('../src/discover');
const { createMigrationProposal } = require('../src/migrate');
const { restoreBackup } = require('../src/backup');

test('migrate creates backups and restore reverts file changes', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-backup-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'migrate-project'), tempRoot, { recursive: true });
    const userHome = path.join(__dirname, 'fixtures', 'discovery-home');

    const originalAgents = fs.readFileSync(path.join(tempRoot, 'AGENTS.md'), 'utf8');
    const discovery = discoverState(tempRoot, { scope: 'project', userHome });
    const result = createMigrationProposal(tempRoot, discovery);

    const agentsPath = path.join(tempRoot, 'AGENTS.md');
    fs.writeFileSync(agentsPath, '# changed\n', 'utf8');

    const restoreResult = restoreBackup(tempRoot, result.backup.backupId);
    assert.equal(restoreResult.restoredCount > 0, true);
    assert.equal(fs.readFileSync(agentsPath, 'utf8'), originalAgents);
});
