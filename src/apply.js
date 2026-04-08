const path = require('path');
const os = require('os');
const { exists, readUtf8, resolveTemplatePath, writeUtf8 } = require('./fs-util');

function applyOutputs(rootDir, loadedRegistry, options) {
    const applied = [];
    const harnessRoot = (options && options.harnessRoot) || path.join(rootDir, 'harness');
    const variables = {
        rootDir,
        harnessRoot,
        userHome: os.homedir()
    };

    for (const output of loadedRegistry.registry.outputs || []) {
        if (output.enabled === false) {
            continue;
        }

        const generatedPath = resolveTemplatePath(output.generated_path, variables, harnessRoot);
        const applyPath = resolveTemplatePath(output.apply_path, variables, harnessRoot);

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
