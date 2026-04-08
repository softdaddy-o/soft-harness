const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initProjectHarness } = require('../src/project');

test('project init creates a project harness structure without removing existing state', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-project-init-'));
    const existingStateDir = path.join(projectRoot, 'harness', 'state', 'discovered');
    fs.mkdirSync(existingStateDir, { recursive: true });
    fs.writeFileSync(path.join(existingStateDir, 'latest.json'), '{}\n', 'utf8');

    const result = initProjectHarness(projectRoot);

    assert.equal(result.harnessRoot, path.join(projectRoot, 'harness'));
    assert.equal(fs.existsSync(result.registryPath), true);
    assert.equal(fs.existsSync(path.join(result.harnessRoot, 'guides', 'shared')), true);
    assert.equal(fs.existsSync(path.join(result.harnessRoot, 'guides', 'claude')), true);
    assert.equal(fs.existsSync(path.join(result.harnessRoot, 'guides', 'codex')), true);
    assert.equal(fs.existsSync(path.join(existingStateDir, 'latest.json')), true);

    fs.rmSync(projectRoot, { recursive: true, force: true });
});
