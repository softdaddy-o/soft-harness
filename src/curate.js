const path = require('node:path');
const { loadPluginOrigins, loadPluginOriginsInput, savePluginOrigins } = require('./plugin-origins');

function parseCurateArgs(args) {
    const target = args.find((arg) => !arg.startsWith('--'));
    if (!target) {
        throw new Error('curate requires a target such as plugins');
    }
    if (target !== 'plugins') {
        throw new Error(`unsupported curate target: ${target}`);
    }

    const inputArg = args.find((arg) => arg.startsWith('--input='));
    if (!inputArg || !inputArg.split('=')[1]) {
        throw new Error('curate plugins requires --input=<path>');
    }

    const root = parseCommandRootArgs(args);
    const account = new Set(args).has('--account');
    if (root && account) {
        throw new Error('cannot combine --root and --account');
    }

    return {
        target,
        input: inputArg.split('=').slice(1).join('='),
        root,
        account
    };
}

function runCurate(rootDir, options) {
    if (!options || options.target !== 'plugins') {
        throw new Error('curate currently supports only plugins');
    }

    const imported = loadPluginOriginsInput(options.input);
    const current = loadPluginOrigins(rootDir);
    const merged = mergePluginOrigins(current, imported);
    const filePath = savePluginOrigins(rootDir, merged);
    return {
        target: 'plugins',
        input: options.input,
        updated: imported.length,
        file: path.relative(rootDir, filePath).split(path.sep).join('/')
    };
}

function mergePluginOrigins(current, imported) {
    const byKey = new Map();
    for (const origin of current || []) {
        byKey.set(makePluginOriginKey(origin), origin);
    }
    for (const origin of imported || []) {
        byKey.set(makePluginOriginKey(origin), origin);
    }
    return Array.from(byKey.values());
}

function makePluginOriginKey(origin) {
    return `${origin.plugin}::${(origin.hosts || []).join(',')}`;
}

function parseCommandRootArgs(args) {
    const rootArg = args.find((arg) => arg.startsWith('--root='));
    if (!rootArg) {
        return null;
    }
    const root = rootArg.split('=').slice(1).join('=').trim();
    if (!root) {
        throw new Error('--root requires a path');
    }
    return root;
}

module.exports = {
    parseCurateArgs,
    runCurate
};
