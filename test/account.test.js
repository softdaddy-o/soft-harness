const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverAccountHarness, doctorAccountHarness, getAccountHarnessRoot, initAccountHarness } = require('../src/account');

const fixturesRoot = path.join(__dirname, 'fixtures');

test('account init creates the account harness structure', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-account-init-'));
    const userHome = path.join(tempRoot, 'home');

    const result = initAccountHarness({ userHome });
    assert.equal(result.harnessRoot, path.join(userHome, '.soft-harness', 'harness'));
    assert.equal(fs.existsSync(result.registryPath), true);
    assert.equal(fs.existsSync(path.join(result.harnessRoot, 'guides', 'claude')), true);
    assert.equal(fs.existsSync(path.join(result.harnessRoot, 'guides', 'codex')), true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('account discover and doctor use the account harness root', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-account-doctor-'));
    const userHome = path.join(tempRoot, 'home');
    const sourceHome = path.join(fixturesRoot, 'discovery-home');

    fs.cpSync(sourceHome, userHome, { recursive: true });
    initAccountHarness({ userHome });

    const discoveryResult = discoverAccountHarness({ userHome });
    assert.equal(discoveryResult.discovery.assets.length > 0, true);
    assert.equal(fs.existsSync(discoveryResult.persisted.latestPath), true);

    const doctorResult = doctorAccountHarness({ userHome });
    assert.equal(doctorResult.harnessRoot, getAccountHarnessRoot({ userHome }));
    assert.equal(doctorResult.findings.some((finding) => finding.code === 'unmanaged-discovered-asset'), true);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});
