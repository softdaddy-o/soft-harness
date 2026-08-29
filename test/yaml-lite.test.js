const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const yamlLite = require('../src/yaml-lite');

const FIXTURES = path.join(__dirname, 'fixtures', 'yaml');

function fixture(name) {
    return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// Accepted inputs only. Rejected syntax is *supposed* to diverge from `yaml`,
// so it gets its own assertions below rather than being differenced.
const ACCEPTED = [
    'settings-portable.yaml',
    'settings-flow-seq.yaml',
    'plugins.yaml',
    'asset-origins.yaml',
    'legacy-folded.yaml',
    'legacy-folded-plain.yaml',
    'legacy-block.yaml'
];

const REJECTED = [
    ['hostile-duplicate-key.yaml', 'duplicate-key'],
    ['hostile-tab-indent.yaml', 'tab-indent'],
    ['rejected-anchor.yaml', 'anchor'],
    ['rejected-flow-map.yaml', 'flow-mapping'],
    ['rejected-multidoc.yaml', 'multi-document'],
    ['rejected-tag.yaml', 'tag']
];

// This suite is why `yaml` stays a devDependency after the runtime drops it:
// deleting the oracle is how a hand-rolled parser drifts.
test('yaml-lite: parses accepted fixtures identically to the yaml package', () => {
    for (const name of ACCEPTED) {
        const text = fixture(name);
        assert.deepEqual(
            yamlLite.parse(text, { filename: name }),
            YAML.parse(text),
            `divergence on ${name}`
        );
    }
});

test('yaml-lite: round-trips accepted fixtures through its own writer', () => {
    for (const name of ACCEPTED) {
        const value = yamlLite.parse(fixture(name), { filename: name });
        const written = yamlLite.stringify(value);
        assert.deepEqual(yamlLite.parse(written), value, `self round-trip failed on ${name}`);
        assert.deepEqual(YAML.parse(written), value, `yaml disagrees with our output on ${name}`);
    }
});

test('yaml-lite: the writer never folds and never emits block scalars', () => {
    const long = 'x'.repeat(400);
    const written = yamlLite.stringify({ notes: long, body: 'line one\nline two' });
    for (const line of written.split('\n')) {
        assert.ok(!/^\s*[|>][+-]?\s*$/.test(line), `writer emitted a block scalar: ${line}`);
    }
    assert.ok(written.includes(long), 'long scalar was folded');
    assert.deepEqual(YAML.parse(written), { notes: long, body: 'line one\nline two' });
});

test('yaml-lite: rejects unsupported constructs with a located error', () => {
    for (const [name, construct] of REJECTED) {
        assert.throws(
            () => yamlLite.parse(fixture(name), { filename: name }),
            (error) => {
                assert.equal(error.name, 'ParseError', `${name} threw ${error.name}`);
                assert.equal(error.construct, construct, `${name} reported ${error.construct}`);
                assert.equal(error.filename, name);
                assert.ok(Number.isInteger(error.line), `${name} has no line number`);
                assert.match(error.message, new RegExp(name.replace('.', '\\.')));
                return true;
            },
            `${name} should have been rejected`
        );
    }
});

test('yaml-lite: implicit typing stays narrow', () => {
    const parsed = yamlLite.parse([
        'nil: null',
        'tilde: ~',
        'empty:',
        'yes_str: yes',
        'date_str: 2026-08-29',
        'inf_str: .inf',
        'zero_padded: 0755',
        'huge: 123456789012345678901234567890',
        'truthy: true',
        'count: 42',
        'ratio: 1.5'
    ].join('\n'));

    assert.equal(parsed.nil, null);
    assert.equal(parsed.tilde, null);
    assert.equal(parsed.empty, null);
    // Deliberately strings: soft-harness never relied on these coercions.
    assert.equal(parsed.yes_str, 'yes');
    assert.equal(parsed.date_str, '2026-08-29');
    assert.equal(parsed.inf_str, '.inf');
    // Matches the `yaml` package rather than "improving" on it: changing this
    // would silently rewrite values already on disk.
    assert.equal(parsed.zero_padded, 755);
    assert.equal(YAML.parse('a: 0755').a, 755);
    // The one deliberate divergence, in the safe direction.
    assert.equal(parsed.huge, '123456789012345678901234567890');
    assert.equal(parsed.truthy, true);
    assert.equal(parsed.count, 42);
    assert.equal(parsed.ratio, 1.5);
});

test('yaml-lite: normalizes BOM and CRLF before parsing', () => {
    const text = '﻿version: 1\r\nname: shared\r\n';
    assert.deepEqual(yamlLite.parse(text), { version: 1, name: 'shared' });
});

test('yaml-lite: quotes only what has to be quoted', () => {
    const written = yamlLite.stringify({
        plain: 'shared',
        colon: 'Contains: a colon',
        hash: 'trailing # hash',
        leading: '- dash',
        numberish: '42',
        boolish: 'true',
        blank: '',
        spaced: ' padded '
    });
    assert.match(written, /^plain: shared$/m);
    assert.match(written, /^colon: "Contains: a colon"$/m);
    assert.match(written, /^numberish: "42"$/m);
    assert.match(written, /^boolish: "true"$/m);
    assert.deepEqual(YAML.parse(written), {
        plain: 'shared',
        colon: 'Contains: a colon',
        hash: 'trailing # hash',
        leading: '- dash',
        numberish: '42',
        boolish: 'true',
        blank: '',
        spaced: ' padded '
    });
});

test('yaml-lite: reads flow sequences of scalars', () => {
    const parsed = yamlLite.parse('args: [shared.js]\nhosts: [claude, codex]\nempty: []\n');
    assert.deepEqual(parsed, { args: ['shared.js'], hosts: ['claude', 'codex'], empty: [] });
});

// Frontmatter fidelity. normalizeSkillMarkdown writes back every key it sees,
// so anything the parser fails to model must survive untouched rather than be
// quietly dropped from someone else's skill.
test('skills: frontmatter name/description match the yaml package', () => {
    const { extractFrontmatter } = require('../src/skills');
    const samples = [
        '---\nname: alpha\ndescription: A short one.\n---\n\nBody\n',
        '---\nname: beta\ndescription: >\n  folded across\n  two lines\nlicense: MIT\n---\n\nBody\n',
        '---\nname: gamma\ndescription: "Contains: a colon"\nversion: 1.2.0\n---\n\nBody\n'
    ];
    for (const sample of samples) {
        const parsed = extractFrontmatter(sample);
        const expected = YAML.parse(sample.split('---\n')[1]);
        assert.equal(parsed.frontmatter.name, expected.name);
        assert.equal(parsed.frontmatter.description, expected.description);
        assert.equal(parsed.lossy, false, `unexpectedly lossy: ${sample.slice(0, 40)}`);
    }
});

test('skills: unparseable frontmatter keeps every other line byte-for-byte', () => {
    const { normalizeSkillMarkdown } = require('../src/skills');
    // An anchor is outside the grammar, so the whole block falls back.
    const content = [
        '---',
        'name: delta',
        'description: original text',
        'defaults: &defaults',
        '  retries: 3',
        'custom-field: keep me exactly',
        '---',
        '',
        'Body text',
        ''
    ].join('\n');

    const out = normalizeSkillMarkdown(content, 'delta');

    assert.match(out, /^defaults: &defaults$/m, 'anchor line was dropped');
    assert.match(out, /^ {2}retries: 3$/m, 'anchor body was dropped');
    assert.match(out, /^custom-field: keep me exactly$/m, 'unknown key was dropped');
    assert.match(out, /^name: delta$/m);
    assert.match(out, /^description: "original text"$/m);
    assert.ok(out.includes('Body text'));
});

// --- the two tests that actually prove the dependency is gone -------------

// Static walk of `require` edges from the CLI entry point. This is what keeps
// llm-eval.js and skill-eval.js (which legitimately keep using `yaml`) out of
// the runtime graph as the code changes.
function reachableFromCli() {
    const entry = path.join(__dirname, '..', 'src', 'cli.js');
    const seen = new Set();
    const queue = [entry];
    const externals = new Map();

    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file)) {
            continue;
        }
        seen.add(file);
        const source = fs.readFileSync(file, 'utf8');
        const pattern = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
        let match;
        while ((match = pattern.exec(source)) !== null) {
            const request = match[1];
            if (request.startsWith('.')) {
                let resolved = path.resolve(path.dirname(file), request);
                if (!resolved.endsWith('.js')) {
                    resolved += '.js';
                }
                if (fs.existsSync(resolved)) {
                    queue.push(resolved);
                }
                continue;
            }
            if (request.startsWith('node:')) {
                continue;
            }
            if (!externals.has(request)) {
                externals.set(request, []);
            }
            externals.get(request).push(path.basename(file));
        }
    }

    return { files: [...seen], externals };
}

test('packaging: nothing reachable from the CLI requires a third-party module', () => {
    const { externals } = reachableFromCli();
    assert.deepEqual(
        [...externals.entries()],
        [],
        `runtime graph pulls in external modules: ${JSON.stringify([...externals.entries()])}`
    );
});

// The plugin must carry the CLI itself, or installing it is not enough and the
// user is back to a second, separate npm install.
test('packaging: the plugin ships the runtime graph and stays in sync with src', () => {
    const { execFileSync } = require('node:child_process');

    const pluginSrc = path.join(__dirname, '..', 'plugins', 'soft-harness', 'src');
    assert.ok(fs.existsSync(path.join(pluginSrc, 'cli.js')), 'plugin does not ship the CLI');

    // Fails loudly if src/ changed and the plugin copy was not refreshed.
    execFileSync(
        process.execPath,
        [path.join(__dirname, '..', 'scripts', 'sync-plugin-src.js'), '--check'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );

    // Dev-only modules keep using `yaml`; they must not reach the bundle.
    for (const excluded of ['llm-eval.js', 'skill-eval.js']) {
        assert.ok(!fs.existsSync(path.join(pluginSrc, excluded)), `${excluded} must not ship in the plugin`);
    }
});

test('packaging: the shipped plugin runs with no node_modules above it', () => {
    const { execFileSync } = require('node:child_process');
    const os = require('node:os');

    // Copy the real plugin directory, not a bundle assembled by this test:
    // otherwise a broken release would still pass.
    const pluginDir = path.join(__dirname, '..', 'plugins', 'soft-harness');
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'soft-harness-plugin-'));
    fs.cpSync(pluginDir, stage, { recursive: true });

    let probe = stage;
    while (true) {
        assert.ok(
            !fs.existsSync(path.join(probe, 'node_modules')),
            `staging dir has node_modules above it at ${probe}`
        );
        const parent = path.dirname(probe);
        if (parent === probe) {
            break;
        }
        probe = parent;
    }

    const output = execFileSync(process.execPath, [path.join(stage, 'src', 'cli.js'), '--help'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    assert.ok(output.length > 0, 'plugin CLI produced no output');
});

// --- regressions from the Codex review of the implementation --------------

test('regression: stringify output is always readable by its own parser', () => {
    const cases = [[], {}, [[1, 2]], { rows: [[1, 2]] }, { a: [[1, 2], [3]] }];
    for (const value of cases) {
        const written = yamlLite.stringify(value);
        assert.deepEqual(yamlLite.parse(written), value, `round-trip failed for ${JSON.stringify(value)}`);
        assert.deepEqual(YAML.parse(written), value, `yaml disagrees for ${JSON.stringify(value)}`);
    }
});

test('regression: a __proto__ key is stored, not swallowed or leaked', () => {
    const parsed = yamlLite.parse('__proto__:\n  polluted: yes\nnormal: 1\n');
    assert.deepEqual(Object.keys(parsed).sort(), ['__proto__', 'normal']);
    assert.equal({}.polluted, undefined, 'prototype was polluted');
});

test('regression: an unterminated quoted flow item is rejected, not truncated', () => {
    assert.throws(
        () => yamlLite.parse('items: ["unterminated]\n', { filename: 'x.yaml' }),
        (error) => error.construct === 'flow-sequence'
    );
});

test('regression: lossy frontmatter neither double-quotes nor eats comments', () => {
    const { normalizeSkillMarkdown } = require('../src/skills');
    const content = [
        '---',
        'name: "My skill"',
        'description: original',
        '# author comment',
        'custom: keep me',
        'anchored: &a',
        '---',
        '',
        'Body',
        ''
    ].join('\n');

    const out = normalizeSkillMarkdown(content, 'fallback');
    assert.match(out, /^name: My skill$/m, 'name was quoted twice');
    assert.match(out, /^# author comment$/m, 'author comment was deleted');
    assert.match(out, /^custom: keep me$/m);
    assert.match(out, /^anchored: &a$/m);
});

test('regression: collapse leaves legitimately periodic content alone', () => {
    const { collapseRepeatedContent } = require('../src/pullback');
    // Short periodicity happens in real prose; collapsing it destroys content.
    assert.equal(collapseRepeatedContent('one\ntwo\none\ntwo\none'), 'one\ntwo\none\ntwo\none');
    assert.equal(collapseRepeatedContent('a\nb\na\nb'), 'a\nb\na\nb');

    // A genuinely duplicated guidance block is still collapsed.
    const block = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
    assert.equal(collapseRepeatedContent([block, block, block].join('\n')), block);
});

test('regression: the lockfile agrees with the manifest about yaml', () => {
    const manifest = require('../package.json');
    const lock = require('../package-lock.json');
    assert.equal(manifest.dependencies, undefined, 'runtime dependencies must stay empty');
    assert.ok(manifest.devDependencies.yaml, 'yaml should remain a devDependency oracle');
    assert.equal(lock.packages[''].dependencies, undefined, 'lockfile still lists a runtime dependency');
    assert.ok(lock.packages['node_modules/yaml'].dev, 'lockfile does not mark yaml as dev-only');
});
