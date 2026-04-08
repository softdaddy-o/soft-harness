const path = require('path');
const { exists, readUtf8, writeUtf8 } = require('./fs-util');

function applyOutputs(rootDir, loadedRegistry) {
    const applied = [];
    const harnessRoot = path.join(rootDir, 'harness');

    for (const output of loadedRegistry.registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const generatedPath = path.resolve(harnessRoot, output.generated_path);
        const applyPath = path.resolve(harnessRoot, output.apply_path);

        if (!exists(generatedPath)) {
            throw new Error(`Generated output does not exist: ${generatedPath}`);
        }

        const applyMode = output.apply_mode || 'copy';
        if (applyMode === 'copy') {
            writeUtf8(applyPath, readUtf8(generatedPath));
        } else if (applyMode === 'stub') {
            writeUtf8(applyPath, buildStubContent(applyPath, generatedPath, output));
        } else {
            throw new Error(`Unsupported apply mode: ${applyMode}`);
        }

        applied.push({
            id: output.id,
            applyPath,
            applyMode
        });
    }

    return applied;
}

function buildStubContent(applyPath, generatedPath, output) {
    const relativeGenerated = path.relative(path.dirname(applyPath), generatedPath).split(path.sep).join('/');

    return [
        '<!-- Managed by soft-harness. Edit guides under harness/ instead. -->',
        `# ${output.id}`,
        '',
        `Generated source: ${relativeGenerated}`,
        '',
        'This is a stable stub.',
        'The generated content lives in the file above.'
    ].join('\n') + '\n';
}

module.exports = {
    applyOutputs
};
