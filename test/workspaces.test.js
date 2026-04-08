const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { addWorkspace, hasWorkspaceMarkers, listWorkspaces, removeWorkspace } = require('../src/workspaces');

test('workspace registry can add, list, and remove workspace paths', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-workspaces-'));
    const userHome = path.join(tempRoot, 'home');
    const workspacePath = path.join(tempRoot, 'repo-one');

    fs.mkdirSync(path.join(workspacePath, '.git'), { recursive: true });

    const added = addWorkspace(workspacePath, { userHome });
    assert.equal(added.action, 'added');
    assert.equal(added.workspace.id, 'repo-one');

    const duplicate = addWorkspace(workspacePath, { userHome });
    assert.equal(duplicate.action, 'existing');

    const listed = listWorkspaces({ userHome });
    assert.equal(listed.registry.workspaces.length, 1);
    assert.equal(listed.registry.workspaces[0].path, workspacePath);

    const removed = removeWorkspace(workspacePath, { userHome });
    assert.equal(removed.action, 'removed');

    const afterRemove = listWorkspaces({ userHome });
    assert.equal(afterRemove.registry.workspaces.length, 0);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('workspace marker detection accepts .git or harness registry', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-markers-'));
    const gitWorkspace = path.join(tempRoot, 'git-workspace');
    const harnessWorkspace = path.join(tempRoot, 'harness-workspace');
    const plainWorkspace = path.join(tempRoot, 'plain-workspace');

    fs.mkdirSync(path.join(gitWorkspace, '.git'), { recursive: true });
    fs.mkdirSync(path.join(harnessWorkspace, 'harness'), { recursive: true });
    fs.writeFileSync(path.join(harnessWorkspace, 'harness', 'registry.yaml'), 'version: 1\n', 'utf8');
    fs.mkdirSync(plainWorkspace, { recursive: true });

    assert.equal(hasWorkspaceMarkers(gitWorkspace), true);
    assert.equal(hasWorkspaceMarkers(harnessWorkspace), true);
    assert.equal(hasWorkspaceMarkers(plainWorkspace), false);

    fs.rmSync(tempRoot, { recursive: true, force: true });
});
