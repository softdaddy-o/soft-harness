const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateOutputs } = require('../src/generate');
const { loadRegistry } = require('../src/registry');

function makeProject() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-gen-v1-'));
    const harnessRoot = path.join(dir, 'harness');
    fs.mkdirSync(path.join(harnessRoot, 'registry.d'), { recursive: true });
    fs.mkdirSync(path.join(harnessRoot, 'guides', 'shared', 'common'), { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'guides', 'shared', 'common', 'project.md'), '# Base guide\nContent here.\n', 'utf8');

    return {
        dir,
        harnessRoot,
        cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

test('generate writes guide bundle directly to apply_path', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), `version: 1
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

    const loaded = loadRegistry(fixture.dir);
    const generated = generateOutputs(fixture.dir, loaded);
    assert.equal(generated.length, 1);
    const content = fs.readFileSync(path.join(fixture.dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /Managed by soft-harness v1/);
    assert.match(content, /Base guide/);
    fixture.cleanup();
});

test('generate resolves install_cmd for known registries and persists it', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), `version: 1
capabilities:
  - id: myplugin
    kind: plugin
    target: claude
    scope: account
    management: external
    source:
      registry: claude-plugins-official
      package: superpowers
      version: "5.0.7"
    install_cmd: null
guides:
  shared: []
  claude: []
  codex: []
outputs: []
`, 'utf8');

    const loaded = loadRegistry(fixture.dir);
    generateOutputs(fixture.dir, loaded);
    const updated = fs.readFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), 'utf8');
    assert.match(updated, /claude plugin install superpowers@claude-plugins-official@5\.0\.7/);
    fixture.cleanup();
});

test('generate no longer writes to harness/generated', () => {
    const fixture = makeProject();
    fs.writeFileSync(path.join(fixture.harnessRoot, 'registry.yaml'), `version: 1
capabilities: []
guides:
  shared: []
  claude: []
  codex: []
outputs: []
`, 'utf8');

    const loaded = loadRegistry(fixture.dir);
    generateOutputs(fixture.dir, loaded);
    assert.equal(fs.existsSync(path.join(fixture.harnessRoot, 'generated')), false);
    fixture.cleanup();
});
