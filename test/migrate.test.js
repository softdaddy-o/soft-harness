const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { discoverState } = require('../src/discover');
const { createMigrationProposal } = require('../src/migrate');

test('migrate creates a proposal file and copies discovered instruction guides', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-migrate-'));
    fs.cpSync(path.join(__dirname, 'fixtures', 'migrate-project'), tempRoot, { recursive: true });
    const userHome = path.join(__dirname, 'fixtures', 'discovery-home');

    const discovery = discoverState(tempRoot, { scope: 'project', userHome });
    const result = createMigrationProposal(tempRoot, discovery);

    assert.equal(fs.existsSync(result.summaryPath), true);
    assert.equal(fs.existsSync(path.join(result.proposalDir, 'guides.generated.yaml')), true);
    assert.equal(result.copiedGuideCount > 0, true);

    const proposal = fs.readFileSync(path.join(result.proposalDir, 'guides.generated.yaml'), 'utf8');
    assert.match(proposal, /guides:/);
    assert.match(proposal, /discovered\/project-AGENTS.md/);
});
