const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildVirtualPc } = require('../src/virtual-pc');
const { exists, readUtf8, writeUtf8 } = require('../src/fs-util');
const { makeTempDir } = require('./helpers');

test('virtual-pc: builds a sanitized fixture with only harness-relevant files', async () => {
    const docsRoot = makeTempDir('soft-harness-virtual-docs-');
    const homeRoot = makeTempDir('soft-harness-virtual-home-');
    const outputRoot = makeTempDir('soft-harness-virtual-output-');
    const homeUser = path.basename(homeRoot);

    writeUtf8(path.join(docsRoot, 'AcmeProject', '.claude', 'settings.json'), JSON.stringify({
        owner: 'muscly',
        email: 'owner@acme.example',
        token: 'ghp_superSecretValue',
        repo: 'https://github.com/acme/private-repo',
        path: `${docsRoot}\\AcmeProject`,
        note: '\uD55C\uAD6D\uC5B4 \uC124\uBA85'
    }, null, 2));
    writeUtf8(path.join(docsRoot, 'AcmeProject', '.harness', 'HARNESS.md'), '# should not copy\n');
    writeUtf8(path.join(docsRoot, 'AcmeProject', 'notes.md'), '# should not copy\n');
    writeUtf8(path.join(homeRoot, '.claude', 'settings.json'), JSON.stringify({
        email: 'person@example.com',
        auth: 'sk-super-secret',
        projectPath: `${homeRoot}\\source\\AcmeProject`
    }, null, 2));
    writeUtf8(path.join(homeRoot, '.harness', 'HARNESS.md'), '# should not copy\n');
    writeUtf8(path.join(homeRoot, 'AGENTS.md'), `Owner ${homeUser} uses AcmeProject.\n`);

    const result = await buildVirtualPc({
        docsRoot,
        homeRoot,
        outputRoot,
        translator: async (line) => line.replace('\uD55C\uAD6D\uC5B4 \uC124\uBA85', 'Korean explanation')
    });
    const docsSettings = path.join(result.docsImageRoot, 'workspace-001', '.claude', 'settings.json');
    const homeSettings = path.join(result.homeImageRoot, '.claude', 'settings.json');
    const homeAgents = path.join(result.homeImageRoot, 'AGENTS.md');

    assert.equal(exists(docsSettings), true);
    assert.equal(exists(homeSettings), true);
    assert.equal(exists(path.join(result.docsImageRoot, 'workspace-001', 'notes.md')), false);
    assert.equal(exists(path.join(result.docsImageRoot, 'workspace-001', '.harness', 'HARNESS.md')), false);
    assert.equal(exists(path.join(result.homeImageRoot, '.harness', 'HARNESS.md')), false);

    const docsText = readUtf8(docsSettings);
    const homeText = readUtf8(homeSettings);

    assert.doesNotMatch(docsText, /muscly/);
    assert.doesNotMatch(docsText, /AcmeProject/);
    assert.doesNotMatch(docsText, /owner@acme\.example/);
    assert.doesNotMatch(docsText, /ghp_superSecretValue/);
    assert.match(docsText, /workspace-001/);
    assert.match(docsText, /example-org\/repo-001/);
    assert.match(docsText, /<REDACTED>/);
    assert.doesNotMatch(docsText, /\uD55C\uAD6D\uC5B4/u);
    assert.match(docsText, /Korean explanation/);

    assert.doesNotMatch(homeText, /person@example\.com/);
    assert.doesNotMatch(homeText, /sk-super-secret/);
    assert.match(homeText, /primary-user/);
    assert.match(homeText, /workspace-001/);
    assert.match(readUtf8(homeAgents), /primary-user/);
    assert.equal(exists(path.join(outputRoot, 'manifest.json')), true);
    assert.equal(exists(path.join(outputRoot, 'TESTING.md')), true);
});
