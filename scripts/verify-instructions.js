// Self-check: do the instruction files behave the way we intended?
// Deterministic and read-only. Run: node verify-instructions.js
const fs = require('fs');
const path = require('path');

// Defaults to this checkout's own src. Pass --src=<path> to run the same
// checks against a deployed copy (the plugin mirror, say) and confirm the
// thing that actually loads behaves like the source.
const srcArg = process.argv.find((a) => a.startsWith('--src='));
const SRC = srcArg ? srcArg.slice(6) : path.join(__dirname, '..', 'src');
const { buildInstructionExports, exportInstructions, buildInstructionState } = require(SRC + '/export.js');
const { areInstructionsExternal, excludedInstructionLlms, readHarnessConfig } = require(SRC + '/harness-config.js');

// Roots to audit: --root=<label>=<path>, repeatable. The default set is the
// author's; anyone else's will differ, so nothing here assumes it exists.
const rootArgs = process.argv.filter((a) => a.startsWith('--root='));
const ROOTS = rootArgs.length
    ? Object.fromEntries(rootArgs.map((a) => {
        const [label, ...rest] = a.slice(7).split('=');
        return [label, rest.join('=')];
    }))
    : {
        ElpisClient: 'F:/src3/Covenant/ElpisClient',
        Docs: 'F:/src3/Docs',
        account: require('os').homedir().split(path.sep).join('/')
    };

for (const [label, dir] of Object.entries(ROOTS)) {
    if (!fs.existsSync(dir)) {
        console.log('  SKIP  ' + label + ' -- no such directory: ' + dir);
        delete ROOTS[label];
    }
}

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
    if (ok) {
        pass++;
        console.log('  PASS  ' + name);
        return;
    }
    fail++;
    failures.push(name + (detail ? ' -- ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''));
}

function section(title) {
    console.log('\n=== ' + title + ' ===');
}

function readIf(p) {
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function loadState(root) {
    const raw = readIf(path.join(root, '.harness', '.sync-state.json'));
    if (!raw) return { assets: { instructions: [] } };
    const state = JSON.parse(raw);
    state.assets = state.assets || {};
    state.assets.instructions = state.assets.instructions || [];
    return state;
}

section('1. ElpisClient -- the CLAUDE.md to AGENTS.md chain');
{
    const root = ROOTS.ElpisClient;
    const claude = readIf(path.join(root, 'CLAUDE.md'));
    check('CLAUDE.md exists', claude !== null);
    check(
        'CLAUDE.md is exactly the AGENTS.md import',
        claude !== null && claude.trim() === '@AGENTS.md',
        claude === null ? 'missing' : JSON.stringify(claude.slice(0, 120))
    );

    const agents = readIf(path.join(root, 'AGENTS.md'));
    check('AGENTS.md exists', agents !== null);
    check(
        'AGENTS.md carries no generated scaffolding',
        agents !== null && !/soft-harness/i.test(agents) && !agents.includes('.harness/HARNESS.md'),
        'a concat stub would name its source fragments'
    );

    if (agents) {
        const seen = new Map();
        agents.split('\n')
            .filter((line) => /^#{1,6} /.test(line))
            .forEach((h) => seen.set(h, (seen.get(h) || 0) + 1));
        const dupes = [...seen].filter((entry) => entry[1] > 1).map((entry) => entry[0] + ' x' + entry[1]);
        check('AGENTS.md has no duplicated heading', dupes.length === 0, dupes.join('; '));
    }

    const nested = readIf(path.join(root, '.claude', 'CLAUDE.md'));
    check(
        'no competing .claude/CLAUDE.md',
        nested === null,
        nested === null ? '' : 'a second project instruction file would load as well'
    );
}

const RELATIVES = [
    'CLAUDE.md', '.claude/CLAUDE.md', 'AGENTS.md', 'GEMINI.md',
    '.harness/HARNESS.md', '.harness/memory/shared.md',
    '.harness/llm/claude.md', '.harness/llm/codex.md', '.harness/llm/gemini.md',
    '.harness/memory/llm/claude.md'
];

function instructionFiles() {
    const found = [];
    for (const label of Object.keys(ROOTS)) {
        for (const rel of RELATIVES) {
            const abs = path.join(ROOTS[label], rel);
            if (fs.existsSync(abs)) found.push({ label, rel, abs });
        }
    }
    return found;
}

// A wrong prefix and an absent target look identical in a naive existence test,
// but only the first is a bug: Claude Code treats an import of a file that was
// never created as a silent no-op, while a prefix that escapes the tree means
// the content the author intended never loads.
section('2. every @import points at the directory it was written for');
{
    for (const file of instructionFiles()) {
        const imports = fs.readFileSync(file.abs, 'utf8').split('\n')
            .map((line) => line.trim())
            .filter((line) => /^@[^\s]+$/.test(line))
            .map((line) => line.slice(1));
        if (!imports.length) continue;

        const root = path.resolve(ROOTS[file.label]);
        const misdirected = [];
        const absent = [];
        for (const spec of imports) {
            const target = path.resolve(path.dirname(file.abs), spec);
            if (fs.existsSync(target)) continue;
            // The same basename resolving from the root is the signature of a
            // stale prefix: the content exists, this file just cannot reach it.
            const fromRoot = path.resolve(root, spec.replace(/^(\.\.\/)+/, ''));
            if (fs.existsSync(fromRoot) && fromRoot !== target) misdirected.push(spec);
            else absent.push(spec);
        }
        check(
            file.label + '/' + file.rel + ' (' + imports.length + ' imports)',
            misdirected.length === 0,
            misdirected.length ? 'resolves outside the tree: ' + misdirected.join(', ') : ''
        );
        if (absent.length) {
            console.log('        INFO  target never created (silent no-op): ' + absent.join(', '));
        }
    }
}

// Pull-back writes host content back into .harness fragments. When it is not
// idempotent it can copy a generated stub into the very fragment that stub was
// generated from, which then re-emits the managed header and a set of imports
// that cannot resolve from the fragment's own directory.
section('2b. no generated stub was pulled back into a .harness fragment');
{
    for (const file of instructionFiles()) {
        if (!file.rel.startsWith('.harness/')) continue;
        const body = fs.readFileSync(file.abs, 'utf8');
        const contaminated = /Managed by soft-harness/i.test(body)
            || /soft-harness prompt:start/.test(body)
            || /^<!-- Regenerate:/m.test(body);
        check(
            file.label + '/' + file.rel + ' is authored content, not a stub echo',
            !contaminated,
            contaminated ? 'contains generated stub markers' : ''
        );
    }
}

// Duplication in a fragment is invisible in the fragment itself but doubles
// every generated file downstream, and mojibake survives as valid UTF-8, so
// neither shows up as a parse or encoding error anywhere.
section('2c. fragments are neither duplicated nor mojibake');
{
    for (const file of instructionFiles()) {
        if (!file.rel.startsWith('.harness/')) continue;
        const body = fs.readFileSync(file.abs, 'utf8');

        const seen = new Map();
        body.split('\n').map((l) => l.trim()).filter((l) => l.length > 30)
            .forEach((l) => seen.set(l, (seen.get(l) || 0) + 1));
        const repeated = [...seen].filter((entry) => entry[1] > 1);
        check(
            file.label + '/' + file.rel + ' has no repeated body line',
            repeated.length === 0,
            repeated.length ? repeated.length + ' lines appear more than once, e.g. '
                + JSON.stringify(repeated[0][0].slice(0, 50)) : ''
        );

        // A '?' welded to a Hangul syllable is the signature of text that was
        // decoded in the wrong code page and re-encoded: the bytes are valid
        // UTF-8 again, so only the shape of the text gives it away.
        const suspects = (body.match(/[가-힣]\?|\?[가-힣]/g) || []).length;
        check(
            file.label + '/' + file.rel + ' shows no mojibake signature',
            suspects < 3,
            suspects >= 3 ? suspects + ' Hangul-adjacent "?" occurrences' : ''
        );
    }
}

section('3. .harness/config.json semantics');
{
    for (const label of Object.keys(ROOTS)) {
        try {
            const cfg = readHarnessConfig(ROOTS[label]);
            check(label + ' config parses', true);
            console.log('        ' + label + ': ' + JSON.stringify(cfg));
        } catch (error) {
            check(label + ' config parses', false, error.message);
        }
    }
    check('ElpisClient opts out of generated instructions', areInstructionsExternal(ROOTS.ElpisClient));
    check('Docs excludes gemini', excludedInstructionLlms(ROOTS.Docs).has('gemini'));
    check('account excludes gemini', excludedInstructionLlms(ROOTS.account).has('gemini'));
}

section('4. exporter dry-run -- what soft-harness would write');
{
    for (const label of Object.keys(ROOTS)) {
        const root = ROOTS[label];
        const state = loadState(root);
        const plan = exportInstructions(root, { state, dryRun: true });
        const targets = plan.exported.map((entry) => entry.llm + ':' + entry.path);
        console.log('        ' + label + ': would write [' + (targets.join(', ') || 'nothing') + ']');

        const llms = buildInstructionExports(root, { state }).map((entry) => entry.llm);
        if (label === 'ElpisClient') {
            check('ElpisClient -- exporter writes nothing', targets.length === 0, targets.join(', '));
            check('ElpisClient -- export plan is empty', llms.length === 0, llms.join(','));
        } else {
            check(label + ' -- gemini not generated', !llms.includes('gemini'), llms.join(','));
            check(label + ' -- claude still generated', llms.includes('claude'), llms.join(','));
            check(label + ' -- codex still generated', llms.includes('codex'), llms.join(','));
        }
    }
}

section('5. .sync-state.json reflects the opt-outs');
{
    for (const label of Object.keys(ROOTS)) {
        const root = ROOTS[label];
        const state = loadState(root);
        const listed = state.assets.instructions.map((i) => i.llm + ':' + i.target).sort();
        const fresh = buildInstructionState(root, state).map((i) => i.llm + ':' + i.target).sort();
        console.log('        ' + label + ': state=[' + (listed.join(', ') || 'empty') + ']');
        check(
            label + ' -- saved state matches what the exporter now owns',
            listed.join('|') === fresh.join('|'),
            'stale=[' + listed.filter((x) => fresh.indexOf(x) === -1).join(', ') + ']'
        );
    }
}

// This is the only section whose evidence is produced elsewhere, so it needs a
// freshness bound: an accumulating log would let it keep passing long after the
// hook was removed, which is worse than not checking at all. verify-runtime.sh
// truncates the log before its probes, so a stale file means "not run today".
const HOOK_LOG = 'C:/Users/muscly/AppData/Local/Temp/claude-instructions-loaded.jsonl';
const HOOK_MAX_AGE_MS = 60 * 60 * 1000;

section('6. InstructionsLoaded hook -- files Claude Code really loaded');
{
    const raw = readIf(HOOK_LOG);
    const ageMs = fs.existsSync(HOOK_LOG) ? Date.now() - fs.statSync(HOOK_LOG).mtimeMs : Infinity;
    if (!raw || !raw.trim()) {
        check('hook log present', false, 'no log yet -- run verify-runtime.sh first');
    } else if (ageMs > HOOK_MAX_AGE_MS) {
        check(
            'hook log is from a recent run',
            false,
            'last written ' + Math.round(ageMs / 60000) + ' min ago; run verify-runtime.sh to refresh'
        );
    } else {
        const rows = raw.split('\n').filter(Boolean).map((line) => {
            try { return JSON.parse(line); } catch (error) { return null; }
        }).filter(Boolean);
        const elpis = rows.filter((r) => String(r.cwd || '').replace(/\\/g, '/').toLowerCase().indexOf('elpisclient') !== -1);
        const paths = [...new Set(elpis.map((r) => r.file_path))];
        paths.forEach((p) => console.log('        loaded: ' + p));
        check('account CLAUDE.md loaded', paths.some((p) => /\.claude[\\/]CLAUDE\.md$/i.test(p)));
        check('project CLAUDE.md loaded', paths.some((p) => /ElpisClient[\\/]CLAUDE\.md$/i.test(p)));
    }
}

console.log('\n' + '='.repeat(52) + '\n  ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
    console.log('\n  실패:');
    failures.forEach((f) => console.log('   - ' + f));
}
process.exit(fail ? 1 : 0);
