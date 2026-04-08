const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { discoverState } = require('../src/discover');
const { runDoctor } = require('../src/doctor');
const { loadRegistry } = require('../src/registry');

const fixturesRoot = path.join(__dirname, 'fixtures');

test('doctor reports plaintext secrets in project mcp config', () => {
    const projectRoot = path.join(fixturesRoot, 'doctor-project');
    const userHome = path.join(fixturesRoot, 'discovery-home');
    const loaded = loadRegistry(projectRoot);
    const discovery = discoverState(projectRoot, { userHome });
    const findings = runDoctor(projectRoot, loaded, discovery);

    assert.equal(findings.some((finding) => finding.code === 'plaintext-secret-in-config'), true);
});
