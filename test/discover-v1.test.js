const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { discoverState } = require('../src/discover');

function makeFixture() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-discover-v1-project-'));
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-discover-v1-home-'));

    fs.mkdirSync(path.join(projectRoot, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, 'AGENTS.md'), '# Project agents\n', 'utf8');

    fs.mkdirSync(path.join(userHome, '.agents', 'skills', 'writer'), { recursive: true });
    fs.writeFileSync(path.join(userHome, '.agents', 'skills', 'writer', 'SKILL.md'), '# Skill\n', 'utf8');
    fs.mkdirSync(path.join(userHome, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers'), { recursive: true });
    fs.writeFileSync(path.join(userHome, '.claude', 'plugins', 'cache', 'claude-plugins-official', 'superpowers', 'package.json'), '{}', 'utf8');
    fs.writeFileSync(path.join(userHome, 'AGENTS.md'), '# Account agents\n', 'utf8');

    return {
        projectRoot,
        userHome,
        cleanup() {
            fs.rmSync(projectRoot, { recursive: true, force: true });
            fs.rmSync(userHome, { recursive: true, force: true });
        }
    };
}

test('discover requires an explicit scope', () => {
    const fixture = makeFixture();
    assert.throws(() => discoverState(fixture.projectRoot, { userHome: fixture.userHome }), /discover requires --scope project\|account/);
    fixture.cleanup();
});

test('discover --scope project writes a project tmp file and excludes account assets', () => {
    const fixture = makeFixture();
    const result = discoverState(fixture.projectRoot, { scope: 'project', userHome: fixture.userHome });

    assert.equal(result.scope, 'project');
    assert.equal(result.tmpPath, path.join(fixture.projectRoot, 'harness', 'state', 'discover-project-tmp.json'));
    assert.equal(fs.existsSync(result.tmpPath), true);
    assert.equal(result.assets.some((asset) => asset.path.startsWith(fixture.userHome)), false);
    assert.equal(result.assets.some((asset) => asset.path === path.join(fixture.projectRoot, 'AGENTS.md')), true);
    fixture.cleanup();
});

test('discover --scope account writes an account tmp file and includes account plugin cache', () => {
    const fixture = makeFixture();
    const result = discoverState(fixture.projectRoot, { scope: 'account', userHome: fixture.userHome });

    assert.equal(result.scope, 'account');
    assert.equal(result.tmpPath, path.join(fixture.projectRoot, 'harness', 'state', 'discover-account-tmp.json'));
    assert.equal(fs.existsSync(result.tmpPath), true);
    assert.equal(result.assets.some((asset) => asset.path === path.join(fixture.userHome, 'AGENTS.md')), true);
    assert.equal(result.assets.some((asset) => asset.classification === 'vendor-cache'), true);
    fixture.cleanup();
});
