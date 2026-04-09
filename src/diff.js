const path = require('path');
const { exists, readUtf8, resolveTemplatePath } = require('./fs-util');
const { buildOutputContent, createPathVariables, getRegistryObject } = require('./generate');

function diffOutputs(rootDir, loadedRegistry, options) {
    const harnessRoot = (options && options.harnessRoot) || path.join(rootDir, 'harness');
    const variables = createPathVariables(rootDir, harnessRoot, options || {});
    const registry = getRegistryObject(loadedRegistry);
    const guidesRoot = registry.defaults && registry.defaults.guides_root
        ? path.resolve(harnessRoot, registry.defaults.guides_root)
        : path.join(harnessRoot, 'guides');
    const diffs = [];

    for (const output of registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const applyPath = resolveTemplatePath(output.apply_path, variables, harnessRoot);
        const desiredContent = buildOutputContent(output, registry, guidesRoot, rootDir);

        if (!exists(applyPath)) {
            diffs.push({ id: output.id, status: 'missing-applied', applyPath });
            continue;
        }

        const appliedContent = readUtf8(applyPath);
        diffs.push({
            id: output.id,
            status: appliedContent === desiredContent ? 'in-sync' : 'different',
            applyPath
        });
    }

    return diffs;
}

module.exports = {
    diffOutputs
};
