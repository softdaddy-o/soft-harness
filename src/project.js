const path = require('path');
const { ensureDir, exists, writeUtf8 } = require('./fs-util');

function initProjectHarness(rootDir) {
    const harnessRoot = path.join(rootDir, 'harness');
    const registryPath = path.join(harnessRoot, 'registry.yaml');
    const directories = [
        path.join(harnessRoot, 'registry.d'),
        path.join(harnessRoot, 'guides', 'shared'),
        path.join(harnessRoot, 'guides', 'claude'),
        path.join(harnessRoot, 'guides', 'codex'),
        path.join(harnessRoot, 'generated', 'project', 'claude'),
        path.join(harnessRoot, 'generated', 'project', 'codex'),
        path.join(harnessRoot, 'state', 'discovered'),
        path.join(harnessRoot, 'state', 'backups')
    ];

    for (const directory of directories) {
        ensureDir(directory);
    }

    if (!exists(registryPath)) {
        writeUtf8(registryPath, buildDefaultProjectRegistry(rootDir));
    }

    return {
        harnessRoot,
        registryPath
    };
}

function buildDefaultProjectRegistry(rootDir) {
    return [
        'version: 0',
        '',
        'meta:',
        `  name: ${path.basename(rootDir) || 'project-harness'}`,
        '  description: Project harness for Claude and Codex environments',
        '',
        'imports:',
        '  - ./registry.d/*.yaml',
        '',
        'defaults:',
        '  secrets_policy: local-only',
        '  generated_files_policy: generated-is-derived',
        '  vendor_install_policy: upstream-owned',
        '  guides_root: ./guides',
        '  ignore:',
        '    doctor_paths: []',
        '    migrate_paths: []',
        '',
        'capabilities: []',
        '',
        'guides:',
        '  shared: []',
        '  claude: []',
        '  codex: []',
        '',
        'outputs: []',
        ''
    ].join('\n');
}

module.exports = {
    initProjectHarness
};
