const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const fixturesRoot = path.join(__dirname, 'fixtures');
const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

test('cli uses the current working directory as the harness root', () => {
    const projectRoot = path.join(fixturesRoot, 'valid-project');
    const latestPath = path.join(projectRoot, 'harness', 'state', 'discovered', 'latest.json');

    fs.rmSync(path.join(projectRoot, 'harness', 'state'), { recursive: true, force: true });

    const result = spawnSync(process.execPath, [cliPath, 'discover'], {
        cwd: projectRoot,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Discovered assets:/);
    assert.equal(fs.existsSync(latestPath), true);
});

test('cli accepts an explicit --root override', () => {
    const projectRoot = path.join(fixturesRoot, 'valid-project');
    const latestPath = path.join(projectRoot, 'harness', 'state', 'discovered', 'latest.json');

    fs.rmSync(path.join(projectRoot, 'harness', 'state'), { recursive: true, force: true });

    const result = spawnSync(process.execPath, [cliPath, 'discover', '--root', projectRoot], {
        cwd: __dirname,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Discovered assets:/);
    assert.equal(fs.existsSync(latestPath), true);
});
