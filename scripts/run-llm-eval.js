#!/usr/bin/env node

const path = require('node:path');
const {
    checkScenarioRun,
    findScenario,
    loadScenarioCatalog,
    prepareScenarioRun
} = require('../src/llm-eval');
const { readUtf8, writeUtf8 } = require('../src/fs-util');
const { spawnSync } = require('node:child_process');

async function main(argv) {
    const command = argv[2];
    const args = argv.slice(3);
    const repoRoot = path.join(__dirname, '..');

    switch (command) {
        case 'list':
            return runList(repoRoot);
        case 'prepare':
            return runPrepare(repoRoot, args);
        case 'codex':
            return runCodex(repoRoot, args);
        case 'check':
            return runCheck(args);
        default:
            printUsage();
            process.exitCode = 1;
    }
}

function runList(repoRoot) {
    const scenarios = loadScenarioCatalog(repoRoot);
    for (const scenario of scenarios) {
        process.stdout.write(`${scenario.id}\t${scenario.skill}\t${scenario.description || ''}\n`);
    }
}

function runPrepare(repoRoot, args) {
    const scenarioRef = args[0];
    if (!scenarioRef) {
        throw new Error('prepare requires a scenario id or file path');
    }

    const outputDir = readOption(args.slice(1), '--output');
    const virtualPcRoot = readOption(args.slice(1), '--virtual-pc-root');
    const scenario = findScenario(repoRoot, scenarioRef);
    const result = prepareScenarioRun({
        repoRoot,
        scenario,
        outputDir,
        virtualPcRoot
    });

    process.stdout.write(`${JSON.stringify({
        scenario: result.scenario.id,
        runDir: result.runDir,
        sandboxRoot: result.sandboxRoot
    }, null, 2)}\n`);
}

function runCodex(repoRoot, args) {
    const scenarioRef = args[0];
    if (!scenarioRef) {
        throw new Error('codex requires a scenario id or file path');
    }

    const outputDir = readOption(args.slice(1), '--output');
    const virtualPcRoot = readOption(args.slice(1), '--virtual-pc-root');
    const model = readOption(args.slice(1), '--model');
    const scenario = findScenario(repoRoot, scenarioRef);
    const prepared = prepareScenarioRun({
        repoRoot,
        scenario,
        outputDir,
        virtualPcRoot,
        stageCodexPlugin: true,
        initGitRepo: true
    });

    const prompt = readUtf8(`${prepared.runDir}\\USER_PROMPT.md`);
    const transcriptPath = `${prepared.runDir}\\transcript.md`;
    const eventsPath = `${prepared.runDir}\\events.jsonl`;
    const command = ['exec', '-C', prepared.sandboxRoot, '--full-auto', '--json', '--output-last-message', transcriptPath];
    if (model) {
        command.push('--model', model);
    }

    const result = spawnSync('codex', command, {
        cwd: repoRoot,
        input: prompt,
        encoding: 'utf8',
        shell: true,
        timeout: 15 * 60 * 1000,
        maxBuffer: 1024 * 1024 * 32
    });

    writeUtf8(eventsPath, result.stdout || '');
    if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `codex exec failed with status ${result.status}`);
    }

    const report = checkScenarioRun({
        runDir: prepared.runDir
    });
    process.stdout.write(`${JSON.stringify({
        scenario: prepared.scenario.id,
        runDir: prepared.runDir,
        sandboxRoot: prepared.sandboxRoot,
        transcriptPath,
        eventsPath,
        check: report
    }, null, 2)}\n`);
    if (!report.ok) {
        process.exitCode = 1;
    }
}

function runCheck(args) {
    const runDir = args[0];
    if (!runDir) {
        throw new Error('check requires a prepared run directory');
    }

    const transcriptPath = readOption(args.slice(1), '--transcript');
    const result = checkScenarioRun({
        runDir,
        transcriptPath
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) {
        process.exitCode = 1;
    }
}

function readOption(args, flag) {
    const index = args.indexOf(flag);
    if (index === -1) {
        return null;
    }
    return args[index + 1] || null;
}

function printUsage() {
    process.stdout.write([
        'Usage:',
        '  node scripts/run-llm-eval.js list',
        '  node scripts/run-llm-eval.js prepare <scenario-id|scenario-path> [--output <dir>] [--virtual-pc-root <dir>]',
        '  node scripts/run-llm-eval.js codex <scenario-id|scenario-path> [--output <dir>] [--virtual-pc-root <dir>] [--model <model>]',
        '  node scripts/run-llm-eval.js check <run-dir> [--transcript <file>]',
        ''
    ].join('\n'));
}

main(process.argv).catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
