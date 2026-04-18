#!/usr/bin/env node

const path = require('node:path');
const { runSkillEvals } = require('../src/skill-eval');

async function main(argv) {
    const options = parseArgs(argv);
    const result = await runSkillEvals(options);

    if (options.json) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
        printHumanReport(result);
    }

    process.exitCode = result.summary.failed > 0 ? 1 : 0;
}

function parseArgs(argv) {
    const options = {};
    for (const arg of argv) {
        if (arg === '--json') {
            options.json = true;
            continue;
        }
        if (arg.startsWith('--virtual-pc-root=')) {
            options.virtualPcRoot = path.resolve(arg.slice('--virtual-pc-root='.length));
            continue;
        }
        if (arg.startsWith('--workspace-root=')) {
            options.workspaceRoot = path.resolve(arg.slice('--workspace-root='.length));
        }
    }
    return options;
}

function printHumanReport(result) {
    process.stdout.write(`skill evals: passed=${result.summary.passed} failed=${result.summary.failed} total=${result.summary.total}\n`);
    for (const check of result.checks) {
        if (check.ok) {
            process.stdout.write(`- ok   ${check.name}\n`);
            continue;
        }
        process.stdout.write(`- fail ${check.name}: ${check.error}\n`);
    }
}

main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`skill evals failed: ${error.message}\n`);
    process.exit(1);
});
