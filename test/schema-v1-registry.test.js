const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadRegistryFromHarnessRoot } = require('../src/registry');

function makeTmp(yaml) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-v1-'));
    const harnessRoot = path.join(dir, 'harness');
    fs.mkdirSync(path.join(harnessRoot, 'registry.d'), { recursive: true });
    fs.writeFileSync(path.join(harnessRoot, 'registry.yaml'), yaml, 'utf8');
    return {
        dir,
        harnessRoot,
        cleanup() {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    };
}

test('v1 registry rejects stub apply_mode', () => {
    const fixture = makeTmp(`version: 1
outputs:
  - id: foo
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
    apply_mode: stub
guides:
  shared: []
  claude: []
  codex: []
capabilities: []
`);

    const loaded = loadRegistryFromHarnessRoot(fixture.harnessRoot);
    assert.equal(loaded.issues.some((issue) => issue.code === 'invalid-output-apply-mode'), true);
    fixture.cleanup();
});

test('v1 registry rejects generated_path', () => {
    const fixture = makeTmp(`version: 1
outputs:
  - id: foo
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
    generated_path: ./generated/foo.md
guides:
  shared: []
  claude: []
  codex: []
capabilities: []
`);

    const loaded = loadRegistryFromHarnessRoot(fixture.harnessRoot);
    assert.equal(loaded.issues.some((issue) => issue.code === 'invalid-output-generated-path'), true);
    fixture.cleanup();
});

test('v1 external capability accepts source with null install_cmd', () => {
    const fixture = makeTmp(`version: 1
capabilities:
  - id: myplugin
    kind: plugin
    target: claude
    scope: account
    management: external
    source:
      registry: claude-plugins-official
      package: superpowers
    install_cmd: null
guides:
  shared: []
  claude: []
  codex: []
outputs: []
`);

    const loaded = loadRegistryFromHarnessRoot(fixture.harnessRoot);
    assert.deepEqual(loaded.issues, []);
    fixture.cleanup();
});

test('v1 external capability accepts missing source and install_cmd', () => {
    const fixture = makeTmp(`version: 1
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

    const loaded = loadRegistryFromHarnessRoot(fixture.harnessRoot);
    assert.deepEqual(loaded.issues, []);
    fixture.cleanup();
});

test('v0 registry remains loadable with legacy output fields', () => {
    const fixture = makeTmp(`version: 0
outputs:
  - id: foo
    target: claude
    scope: project
    content_type: guide-bundle
    guide_buckets: [shared]
    apply_path: ../CLAUDE.md
    apply_mode: stub
    generated_path: ./generated/foo.md
guides:
  shared: []
  claude: []
  codex: []
capabilities: []
`);

    const loaded = loadRegistryFromHarnessRoot(fixture.harnessRoot);
    assert.deepEqual(loaded.issues, []);
    fixture.cleanup();
});
