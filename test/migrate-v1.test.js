const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverState } = require('../src/discover');
const { createMigrationProposal } = require('../src/migrate');

function makeProject() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-migrate-v1-project-'));
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-migrate-v1-home-'));
    const harnessRoot = path.join(rootDir, 'harness');

    fs.mkdirSync(path.join(harnessRoot, 'registry.d'), { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'registry.yaml'), `version: 1
capabilities: []
guides:
  shared: []
  claude: []
  codex: []
outputs: []
`, 'utf8');

    fs.mkdirSync(path.join(userHome, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(userHome, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', 'package.json'), '{}', 'utf8');

    return {
        rootDir,
        userHome,
        cleanup() {
            fs.rmSync(rootDir, { recursive: true, force: true });
            fs.rmSync(userHome, { recursive: true, force: true });
        }
    };
}

test('migrate consumes scoped discover tmp files and records external plugin source data', () => {
    const fixture = makeProject();
    const discovery = discoverState(fixture.rootDir, { scope: 'account', userHome: fixture.userHome });
    const result = createMigrationProposal(fixture.rootDir, { scope: 'account' });

    assert.equal(fs.existsSync(discovery.tmpPath), false);
    assert.equal(fs.existsSync(result.summaryPath), true);

    const proposalPath = path.join(result.proposalDir, 'account-claude.generated.yaml');
    const proposal = fs.readFileSync(proposalPath, 'utf8');
    assert.match(proposal, /management: external/);
    assert.match(proposal, /registry: claude-plugins-official/);
    assert.match(proposal, /package: superpowers/);
    assert.match(proposal, /install_cmd: null/);
    assert.doesNotMatch(proposal, /truth:/);
    fixture.cleanup();
});
