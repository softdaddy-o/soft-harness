#!/usr/bin/env node

const path = require('node:path');
const { buildVirtualPc } = require('../src/virtual-pc');

async function main(argv) {
    const options = parseArgs(argv.slice(2));
    const result = await buildVirtualPc(options);
    process.stdout.write([
        `virtual pc created at ${result.outputRoot}`,
        `home: ${result.homeImageRoot}`,
        `docs: ${result.docsImageRoot}`,
        `copied_files=${result.summary.copied_files}`,
        `skipped_irrelevant_files=${result.summary.skipped_irrelevant_files}`,
        `skipped_binary_files=${result.summary.skipped_binary_files}`,
        `translated_files=${result.summary.translated_files}`,
        `translated_lines=${result.summary.translated_lines}`
    ].join('\n'));
    process.stdout.write('\n');
}

function parseArgs(args) {
    const values = Object.fromEntries(args
        .filter((arg) => arg.startsWith('--') && arg.includes('='))
        .map((arg) => {
            const index = arg.indexOf('=');
            return [arg.slice(2, index), arg.slice(index + 1)];
        }));

    return {
        docsRoot: values['docs-root'] || 'F:\\src3\\docs',
        homeRoot: values['home-root'] || process.env.USERPROFILE || process.env.HOME,
        outputRoot: values['output-root'] || path.join(process.cwd(), 'sandbox', 'virtual-pc')
    };
}

if (require.main === module) {
    main(process.argv).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exit(1);
    });
}
