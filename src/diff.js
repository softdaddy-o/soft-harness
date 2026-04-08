const path = require('path');
const { exists, readUtf8 } = require('./fs-util');

function diffOutputs(rootDir, loadedRegistry) {
    const harnessRoot = path.join(rootDir, 'harness');
    const diffs = [];

    for (const output of loadedRegistry.registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const generatedPath = path.resolve(harnessRoot, output.generated_path);
        const applyPath = path.resolve(harnessRoot, output.apply_path);

        if (!exists(generatedPath)) {
            diffs.push({ id: output.id, status: 'missing-generated', generatedPath, applyPath });
            continue;
        }

        if (!exists(applyPath)) {
            diffs.push({ id: output.id, status: 'missing-applied', generatedPath, applyPath });
            continue;
        }

        const generatedContent = readUtf8(generatedPath);
        const appliedContent = readUtf8(applyPath);
        diffs.push({
            id: output.id,
            status: generatedContent === appliedContent ? 'in-sync' : 'different',
            generatedPath,
            applyPath
        });
    }

    return diffs;
}

module.exports = {
    diffOutputs
};
