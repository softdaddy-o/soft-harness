const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runDoctor } = require('../src/doctor');
const { MANAGED_MARKER } = require('../src/generate');

function makeProject() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-doctor-v1-'));
    fs.mkdirSync(path.join(rootDir, 'harness', 'guides', 'shared'), { recursive: true });
    return {
        rootDir,
        cleanup() {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    };
}

test('doctor warns when an external capability has no install_cmd', () => {
    const fixture = makeProject();
    const findings = runDoctor(fixture.rootDir, {
        capabilities: [{
            id: 'myplugin',
            kind: 'plugin',
            target: 'claude',
            scope: 'account',
            management: 'external',
            source: null,
            install_cmd: null
        }],
        guides: { shared: [], claude: [], codex: [] },
        outputs: []
    }, null, {});

    assert.equal(findings.some((finding) => finding.code === 'MISSING_INSTALL_CMD'), true);
    fixture.cleanup();
});

test('doctor warns when a guide-bundle apply target exists without the managed marker', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.rootDir, 'CLAUDE.md'), '# Hand edited\n', 'utf8');

    const findings = runDoctor(fixture.rootDir, {
        capabilities: [],
        guides: { shared: [], claude: [], codex: [] },
        outputs: [{
            id: 'proj-claude',
            target: 'claude',
            scope: 'project',
            content_type: 'guide-bundle',
            apply_path: '../CLAUDE.md'
        }]
    }, null, {});

    assert.equal(findings.some((finding) => finding.code === 'UNMANAGED_APPLY_TARGET'), true);
    fixture.cleanup();
});

test('doctor does not warn when a guide-bundle target has the managed marker', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.rootDir, 'CLAUDE.md'), `${MANAGED_MARKER}\n# Generated\n`, 'utf8');

    const findings = runDoctor(fixture.rootDir, {
        capabilities: [],
        guides: { shared: [], claude: [], codex: [] },
        outputs: [{
            id: 'proj-claude',
            target: 'claude',
            scope: 'project',
            content_type: 'guide-bundle',
            apply_path: '../CLAUDE.md'
        }]
    }, null, {});

    assert.equal(findings.some((finding) => finding.code === 'UNMANAGED_APPLY_TARGET'), false);
    fixture.cleanup();
});

test('doctor skips marker checks for mcp-json outputs', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.rootDir, '.mcp.json'), '{"mcpServers":{}}', 'utf8');

    const findings = runDoctor(fixture.rootDir, {
        capabilities: [],
        guides: { shared: [], claude: [], codex: [] },
        outputs: [{
            id: 'proj-mcp',
            target: 'both',
            scope: 'project',
            content_type: 'mcp-json',
            apply_path: '../.mcp.json'
        }]
    }, null, {});

    assert.equal(findings.some((finding) => finding.code === 'UNMANAGED_APPLY_TARGET'), false);
    fixture.cleanup();
});
