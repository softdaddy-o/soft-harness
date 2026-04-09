const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { applyOutputs, MANAGED_MARKER } = require('../src/apply');
const { loadRegistry } = require('../src/registry');

function makeProject() {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-apply-v1-'));
    const harnessRoot = path.join(rootDir, 'harness');
    fs.mkdirSync(path.join(harnessRoot, 'registry.d'), { recursive: true });
    fs.mkdirSync(path.join(harnessRoot, 'guides', 'shared', 'common'), { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'guides', 'shared', 'common', 'project.md'), '# Shared guide\nBody.\n', 'utf8');
    fs.writeFileSync(path.join(harnessRoot, 'registry.yaml'), `version: 1
defaults:
  guides_root: ./guides
capabilities: []
guides:
  shared:
    - path: common/project.md
      scope: project
  claude: []
  codex: []
outputs:
  - id: proj-claude
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
`, 'utf8');

    return {
        rootDir,
        cleanup() {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    };
}

test('apply dry-run reports unmanaged targets without changing them', () => {
    const fixture = makeProject();
    const targetPath = path.join(fixture.rootDir, 'CLAUDE.md');
    fs.writeFileSync(targetPath, '# Hand edited\n', 'utf8');

    const loaded = loadRegistry(fixture.rootDir);
    const results = applyOutputs(fixture.rootDir, loaded, { dryRun: true });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'would-write');
    assert.equal(results[0].unmanaged, true);
    assert.equal(fs.readFileSync(targetPath, 'utf8'), '# Hand edited\n');
    fixture.cleanup();
});

test('apply skips unmanaged targets unless force is set', () => {
    const fixture = makeProject();
    const targetPath = path.join(fixture.rootDir, 'CLAUDE.md');
    fs.writeFileSync(targetPath, '# Hand edited\n', 'utf8');

    const loaded = loadRegistry(fixture.rootDir);
    const results = applyOutputs(fixture.rootDir, loaded);

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'skipped-unmanaged');
    assert.equal(fs.readFileSync(targetPath, 'utf8'), '# Hand edited\n');
    fixture.cleanup();
});

test('apply --force with backup writes managed content and records backup manifest', () => {
    const fixture = makeProject();
    const targetPath = path.join(fixture.rootDir, 'CLAUDE.md');
    fs.writeFileSync(targetPath, '# Hand edited\n', 'utf8');

    const loaded = loadRegistry(fixture.rootDir);
    const results = applyOutputs(fixture.rootDir, loaded, {
        force: true,
        backup: true,
        reason: 'apply --backup'
    });

    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'written');
    const applied = fs.readFileSync(targetPath, 'utf8');
    assert.match(applied, new RegExp(`^${MANAGED_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(applied, /Shared guide/);

    const backupsRoot = path.join(fixture.rootDir, 'harness', 'state', 'backups');
    const backupDirs = fs.readdirSync(backupsRoot);
    assert.equal(backupDirs.length, 1);

    const manifestPath = path.join(backupsRoot, backupDirs[0], 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.reason, 'apply --backup');
    assert.deepEqual(manifest.files, [
        {
            original: '../CLAUDE.md',
            backed_up_as: 'CLAUDE.md'
        }
    ]);
    fixture.cleanup();
});
