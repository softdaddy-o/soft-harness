const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { migrateSchema } = require('../src/migrate-schema');

function makeProject(registryYaml, importedYaml) {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-migrate-schema-'));
    const harnessRoot = path.join(rootDir, 'harness');
    fs.mkdirSync(path.join(harnessRoot, 'registry.d'), { recursive: true });
    fs.mkdirSync(path.join(harnessRoot, 'state', 'backups'), { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'registry.yaml'), registryYaml, 'utf8');

    if (importedYaml) {
        fs.writeFileSync(path.join(harnessRoot, 'registry.d', 'external.yaml'), importedYaml, 'utf8');
    }

    return {
        rootDir,
        harnessRoot,
        cleanup() {
            fs.rmSync(rootDir, { recursive: true, force: true });
        }
    };
}

test('migrate-schema dry-run reports changes without writing', () => {
    const fixture = makeProject(`version: 0
outputs:
  - id: proj-claude
    preset: project-claude-stub
`);

    const result = migrateSchema(fixture.rootDir, { dryRun: true });
    assert.ok(result.changes.length > 0);
    const current = fs.readFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), 'utf8');
    assert.match(current, /version: 0/);
    fixture.cleanup();
});

test('migrate-schema upgrades base and imported registries and creates backups', () => {
    const fixture = makeProject(`version: 0
imports:
  - ./registry.d/*.yaml
outputs:
  - id: proj-claude
    preset: project-claude-stub
  - id: direct
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
    apply_mode: copy
    generated_path: ./generated/CLAUDE.generated.md
`, `version: 0
capabilities:
  - id: myplugin
    kind: plugin
    target: claude
    scope: account
    management: external
guides:
  shared: []
  claude: []
  codex: []
outputs: []
`);
    fs.mkdirSync(path.join(fixture.harnessRoot, 'generated'), { recursive: true });
    fs.writeFileSync(path.join(fixture.harnessRoot, 'generated', 'CLAUDE.generated.md'), '# Generated\n', 'utf8');

    const result = migrateSchema(fixture.rootDir, { apply: true });
    assert.ok(result.changes.length > 0);

    const baseUpdated = fs.readFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), 'utf8');
    const importedUpdated = fs.readFileSync(path.join(fixture.harnessRoot, 'registry.d', 'external.yaml'), 'utf8');
    assert.match(baseUpdated, /version: 1/);
    assert.match(baseUpdated, /project-claude/);
    assert.doesNotMatch(baseUpdated, /project-claude-stub/);
    assert.doesNotMatch(baseUpdated, /generated_path/);
    assert.doesNotMatch(baseUpdated, /apply_mode/);
    assert.match(importedUpdated, /source: null/);
    assert.match(importedUpdated, /install_cmd: null/);

    assert.equal(fs.existsSync(path.join(fixture.harnessRoot, 'state', 'backups', 'schema-v0-backup', 'registry.yaml')), true);
    assert.equal(fs.existsSync(path.join(fixture.harnessRoot, 'state', 'backups', 'schema-v0-backup', 'registry.d', 'external.yaml')), true);
    fixture.cleanup();
});

test('migrate-schema halts on stub warnings unless force is set', () => {
    const fixture = makeProject(`version: 0
outputs:
  - id: proj-claude
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
    apply_mode: stub
`);
    fs.writeFileSync(path.join(fixture.rootDir, 'CLAUDE.md'), '# Hand edited\n', 'utf8');

    assert.throws(() => migrateSchema(fixture.rootDir, { apply: true }), /Schema migration halted due to warnings/);
    fixture.cleanup();
});
