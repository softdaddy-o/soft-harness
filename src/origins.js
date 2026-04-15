const path = require('node:path');
const { loadAssetOrigins, loadAssetOriginsInput, saveAssetOrigins } = require('./asset-origins');

function parseOriginsArgs(args) {
    const inputArg = args.find((arg) => arg.startsWith('--input='));
    if (!inputArg || !inputArg.split('=')[1]) {
        throw new Error('origins import requires --input=<path>');
    }

    const root = parseCommandRootArgs(args);
    const account = new Set(args).has('--account');
    if (root && account) {
        throw new Error('cannot combine --root and --account');
    }

    return {
        input: inputArg.split('=').slice(1).join('='),
        root,
        account
    };
}

function importOrigins(rootDir, options) {
    const imported = loadAssetOriginsInput(options.input);
    const current = loadAssetOrigins(rootDir);
    const merged = mergeAssetOrigins(current, imported);
    const filePath = saveAssetOrigins(rootDir, merged);
    return {
        target: 'assets',
        input: options.input,
        updated: imported.length,
        file: path.relative(rootDir, filePath).split(path.sep).join('/')
    };
}

function mergeAssetOrigins(current, imported) {
    const byKey = new Map();
    for (const origin of current || []) {
        byKey.set(makeAssetOriginKey(origin), origin);
    }
    for (const origin of imported || []) {
        byKey.set(makeAssetOriginKey(origin), origin);
    }
    return Array.from(byKey.values());
}

function makeAssetOriginKey(origin) {
    return `${origin.kind}::${origin.asset}::${(origin.hosts || []).join(',')}`;
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
    importOrigins,
    parseOriginsArgs
};
