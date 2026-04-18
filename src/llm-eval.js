const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');
const { copyPath, ensureDir, exists, readUtf8, removePath, walkFiles, writeJson, writeUtf8 } = require('./fs-util');
const { hashFile } = require('./hash');

const DEFAULT_SCENARIO_DIR = path.join('evals', 'scenarios');
const DEFAULT_RUNS_DIR = path.join('sandbox', 'llm-eval-runs');

function listScenarioFiles(repoRoot) {
    const scenarioDir = path.join(resolveRepoRoot(repoRoot), DEFAULT_SCENARIO_DIR);
    if (!exists(scenarioDir)) {
        return [];
    }

    return walkFiles(scenarioDir, (relativePath) => /\.(ya?ml|json)$/iu.test(relativePath))
        .map((entry) => entry.absolutePath)
        .sort((left, right) => left.localeCompare(right));
}

function loadScenarioCatalog(repoRoot) {
    return listScenarioFiles(repoRoot).map((scenarioPath) => loadScenarioFile(scenarioPath));
}

function loadScenarioFile(scenarioPath) {
    const absolutePath = path.resolve(scenarioPath);
    const raw = readUtf8(absolutePath);
    const parsed = absolutePath.endsWith('.json')
        ? JSON.parse(raw)
        : YAML.parse(raw);

    validateScenario(parsed, absolutePath);
    return {
        ...parsed,
        sourcePath: absolutePath
    };
}

function findScenario(repoRoot, scenarioRef) {
    if (!scenarioRef) {
        throw new Error('scenario reference is required');
    }
    if (exists(scenarioRef)) {
        return loadScenarioFile(scenarioRef);
    }

    const catalog = loadScenarioCatalog(repoRoot);
    const match = catalog.find((entry) => entry.id === scenarioRef);
    if (!match) {
        throw new Error(`scenario not found: ${scenarioRef}`);
    }
    return match;
}

function prepareScenarioRun(options = {}) {
    const repoRoot = resolveRepoRoot(options.repoRoot);
    const scenario = options.scenario
        ? normalizeScenario(options.scenario)
        : findScenario(repoRoot, options.scenarioRef);
    const roots = resolveVirtualPcRoots(repoRoot, options.virtualPcRoot);
    const sourceRoot = resolveScenarioSourceRoot(scenario, roots);
    const runDir = resolveRunDir(repoRoot, scenario.id, options.outputDir);
    const sandboxRoot = path.join(runDir, 'sandbox-root');

    removePath(runDir);
    ensureDir(runDir);
    copyPath(sourceRoot, sandboxRoot);
    applyScenarioMutations(sandboxRoot, scenario);
    const stagedAssets = stageCodexEvalAssets(repoRoot, sandboxRoot, options);
    if (options.initGitRepo) {
        initGitRepo(sandboxRoot);
    }

    const beforeManifest = buildManifest(sandboxRoot);
    const metadata = {
        schema_version: 1,
        prepared_at: new Date().toISOString(),
        repo_root: repoRoot,
        scenario_id: scenario.id,
        scenario_source: scenario.sourcePath || null,
        skill: scenario.skill,
        source_root: sourceRoot,
        sandbox_root: sandboxRoot,
        staged_assets: stagedAssets,
        flags: scenario.flags || {},
        expectations: scenario.expectations || {},
        before_manifest_path: path.join(runDir, 'before-manifest.json'),
        transcript_path: path.join(runDir, 'transcript.md')
    };

    writeJson(path.join(runDir, 'before-manifest.json'), beforeManifest);
    writeJson(path.join(runDir, 'eval-run.json'), metadata);
    writeUtf8(path.join(runDir, 'scenario.yaml'), YAML.stringify(stripScenarioRuntimeFields(scenario)));
    writeUtf8(path.join(runDir, 'USER_PROMPT.md'), buildUserPrompt(scenario, sandboxRoot, stagedAssets));
    writeUtf8(path.join(runDir, 'RUNBOOK.md'), buildRunbook(runDir, scenario, sandboxRoot, stagedAssets));
    writeUtf8(path.join(runDir, 'transcript.md'), '');

    return {
        runDir,
        sandboxRoot,
        sourceRoot,
        scenario,
        beforeManifest
    };
}

function checkScenarioRun(options = {}) {
    const runDir = path.resolve(options.runDir || '');
    const metadataPath = path.join(runDir, 'eval-run.json');
    if (!exists(metadataPath)) {
        throw new Error(`eval run metadata not found: ${metadataPath}`);
    }

    const metadata = JSON.parse(readUtf8(metadataPath));
    const sandboxRoot = metadata.sandbox_root;
    const beforeManifest = JSON.parse(readUtf8(metadata.before_manifest_path));
    const afterManifest = buildManifest(sandboxRoot);
    const diff = diffManifests(beforeManifest, afterManifest);
    const transcriptPath = resolveTranscriptPath(runDir, options.transcriptPath, metadata.transcript_path);
    const transcript = transcriptPath && exists(transcriptPath) ? readUtf8(transcriptPath) : '';
    const expectations = metadata.expectations || {};
    const issues = [];

    checkFilesystemExpectations(sandboxRoot, diff, expectations.filesystem || {}, issues);
    checkTranscriptExpectations(transcript, expectations.transcript || {}, issues);
    checkRunnerExpectations(transcript, metadata, issues);

    const result = {
        ok: issues.length === 0,
        scenario_id: metadata.scenario_id,
        skill: metadata.skill,
        run_dir: runDir,
        sandbox_root: sandboxRoot,
        diff: summarizeDiff(diff),
        transcript: {
            path: transcriptPath || null,
            present: Boolean(transcript),
            question_lines: countQuestionLines(transcript)
        },
        issues
    };

    writeJson(path.join(runDir, 'check-report.json'), result);
    writeUtf8(path.join(runDir, 'check-report.md'), renderCheckReport(result));
    return result;
}

function resolveRepoRoot(repoRoot) {
    return path.resolve(repoRoot || path.join(__dirname, '..'));
}

function resolveVirtualPcRoots(repoRoot, virtualPcRoot) {
    const baseRoot = path.resolve(virtualPcRoot || path.join(repoRoot, 'sandbox', 'virtual-pc'));
    const imageRoot = exists(path.join(baseRoot, 'pc-image'))
        ? path.join(baseRoot, 'pc-image')
        : baseRoot;
    return {
        imageRoot,
        accountRoot: path.join(imageRoot, 'C', 'Users', 'primary-user'),
        workspaceRoot: path.join(imageRoot, 'F', 'src3', 'docs')
    };
}

function normalizeScenario(scenario) {
    validateScenario(scenario, '<inline>');
    return {
        ...scenario
    };
}

function resolveScenarioSourceRoot(scenario, roots) {
    const root = scenario.root || {};
    if (root.kind === 'account') {
        return path.resolve(roots.accountRoot, root.relative_path || '.');
    }
    if (root.kind === 'workspace') {
        return path.resolve(roots.workspaceRoot, root.relative_path || '.');
    }
    throw new Error(`unsupported scenario root kind: ${root.kind}`);
}

function resolveRunDir(repoRoot, scenarioId, outputDir) {
    if (outputDir) {
        return path.resolve(outputDir);
    }
    const stamp = timestampForPath(new Date());
    return path.join(repoRoot, DEFAULT_RUNS_DIR, `${scenarioId}-${stamp}`);
}

function applyScenarioMutations(sandboxRoot, scenario) {
    for (const relativePath of scenario.remove_paths || []) {
        removePath(path.join(sandboxRoot, relativePath));
    }

    for (const [relativePath, content] of Object.entries(scenario.seed_files || {})) {
        writeUtf8(path.join(sandboxRoot, relativePath), String(content || ''));
    }
}

function buildManifest(rootDir) {
    return {
        generated_at: new Date().toISOString(),
        root: rootDir,
        files: walkFiles(rootDir).map((entry) => ({
            path: entry.relativePath,
            hash: hashFile(entry.absolutePath)
        })).sort((left, right) => left.path.localeCompare(right.path))
    };
}

function diffManifests(beforeManifest, afterManifest) {
    const before = indexManifest(beforeManifest);
    const after = indexManifest(afterManifest);
    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];
    const paths = new Set([...before.keys(), ...after.keys()]);

    for (const relativePath of Array.from(paths).sort()) {
        const beforeHash = before.get(relativePath);
        const afterHash = after.get(relativePath);
        if (!beforeHash && afterHash) {
            added.push(relativePath);
            continue;
        }
        if (beforeHash && !afterHash) {
            removed.push(relativePath);
            continue;
        }
        if (beforeHash !== afterHash) {
            changed.push(relativePath);
            continue;
        }
        unchanged.push(relativePath);
    }

    return {
        added,
        removed,
        changed,
        unchanged
    };
}

function indexManifest(manifest) {
    return new Map((manifest.files || []).map((entry) => [entry.path, entry.hash]));
}

function summarizeDiff(diff) {
    return {
        added: diff.added,
        removed: diff.removed,
        changed: diff.changed,
        unchanged_count: diff.unchanged.length
    };
}

function resolveTranscriptPath(runDir, explicitPath, defaultPath) {
    if (explicitPath) {
        return path.resolve(explicitPath);
    }
    if (defaultPath) {
        return defaultPath;
    }
    const fallback = path.join(runDir, 'transcript.md');
    return exists(fallback) ? fallback : null;
}

function checkFilesystemExpectations(sandboxRoot, diff, expectations, issues) {
    const wrote = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0;

    if (expectations.must_not_write && wrote) {
        issues.push(`filesystem changed during a must_not_write scenario: ${formatPathList(diff.added, diff.changed, diff.removed)}`);
    }
    if (expectations.must_write && !wrote) {
        issues.push('filesystem did not change during a must_write scenario');
    }

    for (const relativePath of expectations.required_paths || []) {
        if (!exists(path.join(sandboxRoot, relativePath))) {
            issues.push(`required path missing: ${relativePath}`);
        }
    }
    for (const relativePath of expectations.forbidden_paths || []) {
        if (exists(path.join(sandboxRoot, relativePath))) {
            issues.push(`forbidden path present: ${relativePath}`);
        }
    }
    for (const relativePath of expectations.changed_paths || []) {
        if (!diff.added.includes(relativePath) && !diff.changed.includes(relativePath) && !diff.removed.includes(relativePath)) {
            issues.push(`expected changed path was not changed: ${relativePath}`);
        }
    }
    for (const relativePath of expectations.unchanged_paths || []) {
        if (diff.added.includes(relativePath) || diff.changed.includes(relativePath) || diff.removed.includes(relativePath)) {
            issues.push(`expected unchanged path was modified: ${relativePath}`);
        }
    }

    if (expectations.backup_required && !exists(path.join(sandboxRoot, '.harness', 'backups'))) {
        issues.push('expected .harness/backups to exist after organize run');
    }
    if (expectations.backup_forbidden && exists(path.join(sandboxRoot, '.harness', 'backups'))) {
        issues.push('expected .harness/backups to remain absent');
    }
}

function checkTranscriptExpectations(transcript, expectations, issues) {
    if ((expectations.must_mention || []).length > 0 && !transcript) {
        issues.push('transcript is missing but transcript expectations were provided');
        return;
    }

    for (const term of expectations.must_mention || []) {
        if (!transcriptContains(transcript, term)) {
            issues.push(`transcript did not mention required term: ${term}`);
        }
    }
    for (const term of expectations.must_not_mention || []) {
        if (transcriptContains(transcript, term)) {
            issues.push(`transcript mentioned forbidden term: ${term}`);
        }
    }

    if (typeof expectations.max_question_lines === 'number') {
        const questionLines = countQuestionLines(transcript);
        if (questionLines > expectations.max_question_lines) {
            issues.push(`transcript asked too many follow-up questions: ${questionLines} > ${expectations.max_question_lines}`);
        }
    }
}

function countQuestionLines(transcript) {
    return String(transcript || '')
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && line.includes('?'))
        .length;
}

const TRANSCRIPT_TERM_ALIASES = {
    analyze: [
        'analysis',
        'inspect',
        'review',
        '\ubd84\uc11d',
        '\uac80\ud1a0',
        '\uc810\uac80'
    ],
    organize: [
        'organise',
        'organization',
        'reorganize',
        '\uc815\ub9ac'
    ],
    'dry-run': [
        'dry run',
        '--dry-run',
        'read-only',
        'no writes performed',
        'no files were changed',
        '\ubcc0\uacbd\ud558\uc9c0 \uc54a\uc558',
        '\ud30c\uc77c\uc740 \ubcc0\uacbd\ud558\uc9c0 \uc54a\uc558'
    ],
    shared: [
        'shareable',
        'portable',
        'common',
        '\uacf5\uc720',
        '\uacf5\ud1b5'
    ],
    'host-local': [
        'host local',
        'host-specific',
        'host specific',
        'host-coupled',
        'path-dependent',
        'path dependent',
        'local overlay',
        '\ub85c\uceec',
        '\ud638\uc2a4\ud2b8\ubcc4',
        '\ud638\uc2a4\ud2b8 \uc804\uc6a9',
        '\ud658\uacbd\ubcc4'
    ],
    'host changes': [
        'host change',
        'changes to host files',
        'host files would be updated',
        'host files would change',
        'host-facing changes',
        'authoritative files would be updated',
        '\ud638\uc2a4\ud2b8 \ubcc0\uacbd',
        '\ud638\uc2a4\ud2b8 \ud30c\uc77c \ubcc0\uacbd',
        '\ud638\uc2a4\ud2b8 \ud30c\uc77c\uc774 \uc5c5\ub370\uc774\ud2b8',
        '\ud638\uc2a4\ud2b8 \ud30c\uc77c\uc774 \ubcc0\uacbd'
    ],
    optimization: [
        'optimizations',
        'optimize',
        'proposal',
        'recommendation',
        'de-duplication opportunity',
        '\ucd5c\uc801\ud654',
        '\uac1c\uc120 \uc81c\uc548',
        '\uc81c\uc548'
    ],
    memory: [
        'remember',
        'decision memory',
        '\uae30\uc5b5',
        '\uba54\ubaa8\ub9ac',
        '\uba54\ubaa8'
    ],
    backup: [
        'backups',
        'rollback',
        '\ubc31\uc5c5'
    ]
};

function transcriptContains(transcript, term) {
    const text = String(transcript || '');
    const needle = String(term || '');
    if (!needle) {
        return false;
    }
    const normalizedText = normalizeComparableText(text);
    for (const candidate of getTranscriptCandidates(needle)) {
        if (phraseContained(text, normalizedText, candidate)) {
            return true;
        }
    }
    return false;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getTranscriptCandidates(term) {
    const needle = String(term || '').trim();
    if (!needle) {
        return [];
    }
    const aliases = TRANSCRIPT_TERM_ALIASES[needle.toLowerCase()] || [];
    return Array.from(new Set([needle, ...aliases]));
}

function phraseContained(rawText, normalizedText, candidate) {
    const needle = String(candidate || '').trim();
    if (!needle) {
        return false;
    }

    if (/^[A-Za-z0-9]+$/u.test(needle)) {
        return regexWordBoundaryMatch(rawText, needle, /[A-Za-z0-9_-]/u);
    }

    if (rawText.toLowerCase().includes(needle.toLowerCase())) {
        return true;
    }

    const normalizedNeedle = normalizeComparableText(needle);
    if (!normalizedNeedle) {
        return false;
    }
    return normalizedText.includes(normalizedNeedle);
}

function regexWordBoundaryMatch(text, needle, wordCharPattern) {
    if (!needle) {
        return false;
    }
    const source = `(?<!${wordCharPattern.source})${escapeRegex(needle)}(?!${wordCharPattern.source})`;
    return new RegExp(source, 'iu').test(text);
}

function normalizeComparableText(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[`*_#()[\]{}<>|]/gu, ' ')
        .replace(/[-_/]+/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim();
}

function renderCheckReport(result) {
    const lines = [
        '# LLM Eval Check Report',
        '',
        `- Scenario: ${result.scenario_id}`,
        `- Skill: ${result.skill}`,
        `- Passed: ${result.ok ? 'yes' : 'no'}`,
        `- Run dir: ${result.run_dir}`,
        `- Sandbox root: ${result.sandbox_root}`,
        `- Transcript present: ${result.transcript.present ? 'yes' : 'no'}`,
        `- Question lines: ${result.transcript.question_lines}`,
        '',
        '## Diff',
        '',
        `- Added: ${result.diff.added.length}`,
        `- Changed: ${result.diff.changed.length}`,
        `- Removed: ${result.diff.removed.length}`,
        ''
    ];

    appendPathSection(lines, 'Added', result.diff.added);
    appendPathSection(lines, 'Changed', result.diff.changed);
    appendPathSection(lines, 'Removed', result.diff.removed);

    if (result.issues.length > 0) {
        lines.push('## Issues');
        lines.push('');
        for (const issue of result.issues) {
            lines.push(`- ${issue}`);
        }
        lines.push('');
    }

    return `${lines.join('\n').trim()}\n`;
}

function appendPathSection(lines, title, items) {
    if (!items || items.length === 0) {
        return;
    }
    lines.push(`### ${title}`);
    lines.push('');
    for (const relativePath of items) {
        lines.push(`- ${relativePath}`);
    }
    lines.push('');
}

function buildUserPrompt(scenario, sandboxRoot, stagedAssets) {
    const lines = [
        `Skill: ${scenario.skill}`,
        `Sandbox root: ${sandboxRoot}`,
        `Dry run: ${scenario.flags && scenario.flags.dry_run ? 'yes' : 'no'}`,
        `Web allowed: ${scenario.flags && scenario.flags.web_allowed ? 'yes' : 'no'}`,
        ''
    ];
    if (stagedAssets.length > 0) {
        lines.push('Evaluation note: this sandbox includes staged plugin scaffolding only so Codex can load the test skill.');
        lines.push(`Ignore these staged paths when summarizing host state unless they are directly relevant to debugging the skill: ${stagedAssets.join(', ')}`);
        lines.push('');
    }
    lines.push(scenario.user_request.trim());
    lines.push('');
    return lines.join('\n');
}

function buildRunbook(runDir, scenario, sandboxRoot, stagedAssets) {
    const lines = [
        '# LLM Eval Runbook',
        '',
        `Scenario: ${scenario.id}`,
        `Skill: ${scenario.skill}`,
        `Sandbox root: ${sandboxRoot}`,
        '',
        '## Steps',
        '',
        `1. Open \`${sandboxRoot}\` in Claude Code or Codex.`,
        `2. Invoke the \`${scenario.skill}\` skill with the exact user request in [USER_PROMPT.md](./USER_PROMPT.md).`,
        '3. Save the full transcript into `transcript.md` in this run directory.',
        `4. Run \`node scripts/run-llm-eval.js check "${runDir}"\` from the repository root.`,
        '',
        '## Notes',
        '',
        '- The fixture starts from the copied sandbox only. Do not run against the immutable base virtual PC tree.',
        '- The checker scores file writes plus transcript expectations from the scenario.'
    ];
    if (stagedAssets.length > 0) {
        lines.push(`- Staged plugin scaffolding is present for Codex under: ${stagedAssets.join(', ')}`);
        lines.push('- Treat those staged paths as eval infrastructure, not host state to be consolidated.');
    }
    lines.push('');
    return lines.join('\n');
}

function stripScenarioRuntimeFields(scenario) {
    const copy = { ...scenario };
    delete copy.sourcePath;
    return copy;
}

function validateScenario(scenario, label) {
    if (!scenario || typeof scenario !== 'object') {
        throw new Error(`scenario must be an object: ${label}`);
    }
    if (!scenario.id || typeof scenario.id !== 'string') {
        throw new Error(`scenario id is required: ${label}`);
    }
    if (!['analyze', 'organize'].includes(scenario.skill)) {
        throw new Error(`scenario skill must be analyze or organize: ${label}`);
    }
    if (!scenario.root || typeof scenario.root !== 'object') {
        throw new Error(`scenario root is required: ${label}`);
    }
    if (!['account', 'workspace'].includes(scenario.root.kind)) {
        throw new Error(`scenario root.kind must be account or workspace: ${label}`);
    }
    if (!scenario.user_request || typeof scenario.user_request !== 'string') {
        throw new Error(`scenario user_request is required: ${label}`);
    }
}

function formatPathList(added, changed, removed) {
    const parts = [];
    if (added.length > 0) {
        parts.push(`added=${added.join(', ')}`);
    }
    if (changed.length > 0) {
        parts.push(`changed=${changed.join(', ')}`);
    }
    if (removed.length > 0) {
        parts.push(`removed=${removed.join(', ')}`);
    }
    return parts.join(' | ');
}

function stageCodexEvalAssets(repoRoot, sandboxRoot, options) {
    if (!options || !options.stageCodexPlugin) {
        return [];
    }

    const staged = [];
    const marketplaceSource = path.join(repoRoot, '.agents', 'plugins', 'marketplace.json');
    const marketplaceTarget = path.join(sandboxRoot, '.agents', 'plugins', 'marketplace.json');
    if (exists(marketplaceSource)) {
        ensureDir(path.dirname(marketplaceTarget));
        copyPath(marketplaceSource, marketplaceTarget);
        staged.push('.agents/plugins/marketplace.json');
    }

    const pluginSource = path.join(repoRoot, 'plugins', 'soft-harness');
    const pluginTarget = path.join(sandboxRoot, 'plugins', 'soft-harness');
    if (exists(pluginSource)) {
        ensureDir(path.dirname(pluginTarget));
        copyPath(pluginSource, pluginTarget);
        staged.push('plugins/soft-harness');
    }

    return staged;
}

function initGitRepo(rootDir) {
    if (exists(path.join(rootDir, '.git'))) {
        return;
    }

    const result = spawnSync('git', ['init'], {
        cwd: rootDir,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(`git init failed in ${rootDir}: ${result.stderr || result.stdout}`);
    }
}

function checkRunnerExpectations(transcript, metadata, issues) {
    if (metadata.staged_assets && metadata.staged_assets.length > 0 && transcriptContains(transcript, 'not exposed')) {
        issues.push('transcript says the staged skill or plugin was not exposed');
    }
}

function timestampForPath(date) {
    const current = date || new Date();
    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const hours = String(current.getHours()).padStart(2, '0');
    const minutes = String(current.getMinutes()).padStart(2, '0');
    const seconds = String(current.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

module.exports = {
    checkScenarioRun,
    countQuestionLines,
    diffManifests,
    findScenario,
    listScenarioFiles,
    loadScenarioCatalog,
    loadScenarioFile,
    prepareScenarioRun,
    resolveVirtualPcRoots,
    transcriptContains
};
