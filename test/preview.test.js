const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { collectPreview } = require('../src/preview');
const { loadRegistry } = require('../src/registry');

const cliPath = path.join(__dirname, '..', 'src', 'cli.js');

function makeProject() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-preview-'));
    const harnessRoot = path.join(rootDir, 'harness');
    const discoveredDir = path.join(harnessRoot, 'registry.d', 'discovered');

    fs.mkdirSync(path.join(harnessRoot, 'guides', 'codex', 'discovered'), { recursive: true });
    fs.mkdirSync(discoveredDir, { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'guides', 'codex', 'discovered', 'project-AGENTS.md'), '# Saved guide\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'AGENTS.md'), '# Hand edited\n', 'utf8');
    fs.writeFileSync(path.join(harnessRoot, 'registry.yaml'), `version: 1
defaults:
  guides_root: ./guides
imports:
  - ./registry.d/*.yaml
capabilities: []
guides:
  shared: []
  claude: []
  codex: []
outputs:
  - id: project-codex
    preset: project-codex
`, 'utf8');
    fs.writeFileSync(path.join(harnessRoot, 'registry.d', 'approved-guides.generated.yaml'), `capabilities: []
guides:
  shared: []
  claude: []
  codex:
    - path: discovered/project-AGENTS.md
      scope: project
`, 'utf8');
    fs.writeFileSync(path.join(discoveredDir, 'summary.json'), JSON.stringify({
        proposalFiles: ['a.generated.yaml', 'b.generated.yaml'],
        copiedGuideCount: 1,
        capabilityCount: 2
    }, null, 2), 'utf8');

    return {
        rootDir,
        cleanup() {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    };
}

test('collectPreview summarizes registry, proposals, diff, apply, and doctor without persisting discovery', () => {
    const fixture = makeProject();
    const tmpPath = path.join(fixture.rootDir, 'harness', 'state', 'discover-project-tmp.json');
    const loaded = loadRegistry(fixture.rootDir);
    const preview = collectPreview(fixture.rootDir, loaded);

    assert.equal(preview.registry.outputs, 1);
    assert.equal(preview.discovery.scope, 'project');
    assert.equal(preview.discovery.persisted, false);
    assert.equal(fs.existsSync(tmpPath), false);
    assert.equal(preview.proposals.pending, 2);
    assert.equal(preview.proposals.copiedGuides, 1);
    assert.equal(preview.proposals.capabilityProposals, 2);
    assert.equal(preview.diff.counts.different, 1);
    assert.equal(preview.apply.counts['would-write'], 1);
    assert.equal(preview.doctor.warnings > 0, true);
    fixture.cleanup();
});

test('cli preview prints combined state and does not write discover tmp files', () => {
    const fixture = makeProject();
    const tmpPath = path.join(fixture.rootDir, 'harness', 'state', 'discover-project-tmp.json');

    const result = spawnSync(process.execPath, [cliPath, 'preview'], {
        cwd: fixture.rootDir,
        encoding: 'utf8'
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Discovery tmp persisted: no/);
    assert.match(result.stdout, /Pending proposals: 2/);
    assert.match(result.stdout, /Diff statuses: different=1/);
    assert.match(result.stdout, /Apply statuses: would-write=1/);
    assert.equal(fs.existsSync(tmpPath), false);
    fixture.cleanup();
});
