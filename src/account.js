const os = require('os');
const path = require('path');
const { applyOutputs } = require('./apply');
const { diffOutputs } = require('./diff');
const { discoverAccountState, persistDiscoveryAtHarnessRoot } = require('./discover');
const { runDoctor } = require('./doctor');
const { ensureDir, exists, writeUtf8 } = require('./fs-util');
const { generateOutputs } = require('./generate');
const { loadRegistryFromHarnessRoot } = require('./registry');

function getAccountHarnessRoot(options) {
    const userHome = (options && options.userHome) || os.homedir();
    return path.join(userHome, '.soft-harness', 'harness');
}

function initAccountHarness(options) {
    const harnessRoot = getAccountHarnessRoot(options);
    const registryPath = path.join(harnessRoot, 'registry.yaml');
    const directories = [
        path.join(harnessRoot, 'registry.d'),
        path.join(harnessRoot, 'guides', 'shared'),
        path.join(harnessRoot, 'guides', 'claude'),
        path.join(harnessRoot, 'guides', 'codex'),
        path.join(harnessRoot, 'generated', 'account', 'claude'),
        path.join(harnessRoot, 'generated', 'account', 'codex'),
        path.join(harnessRoot, 'state', 'discovered'),
        path.join(harnessRoot, 'state', 'backups')
    ];

    for (const directory of directories) {
        ensureDir(directory);
    }

    if (!exists(registryPath)) {
        writeUtf8(registryPath, buildDefaultAccountRegistry());
    }

    return {
        harnessRoot,
        registryPath
    };
}

function loadAccountRegistry(options) {
    const harnessRoot = getAccountHarnessRoot(options);
    return loadRegistryFromHarnessRoot(harnessRoot);
}

function discoverAccountHarness(options) {
    const harnessRoot = getAccountHarnessRoot(options);
    const discovery = discoverAccountState(options);
    const persisted = persistDiscoveryAtHarnessRoot(harnessRoot, discovery);

    return {
        harnessRoot,
        discovery,
        persisted
    };
}

function doctorAccountHarness(options) {
    const userHome = (options && options.userHome) || os.homedir();
    const harnessRoot = getAccountHarnessRoot(options);
    const loaded = loadRegistryFromHarnessRoot(harnessRoot);
    const discovery = discoverAccountState(options);
    const findings = runDoctor(userHome, loaded, discovery, {
        harnessRoot,
        includeProjectMcp: false
    });

    return {
        harnessRoot,
        loaded,
        discovery,
        findings
    };
}

function generateAccountOutputs(options) {
    const userHome = (options && options.userHome) || os.homedir();
    const harnessRoot = getAccountHarnessRoot(options);
    const loaded = loadRegistryFromHarnessRoot(harnessRoot);
    return {
        harnessRoot,
        loaded,
        generated: generateOutputs(userHome, loaded, { harnessRoot })
    };
}

function applyAccountOutputs(options) {
    const userHome = (options && options.userHome) || os.homedir();
    const harnessRoot = getAccountHarnessRoot(options);
    const loaded = loadRegistryFromHarnessRoot(harnessRoot);
    generateOutputs(userHome, loaded, { harnessRoot });
    return {
        harnessRoot,
        loaded,
        applied: applyOutputs(userHome, loaded, { harnessRoot })
    };
}

function diffAccountOutputs(options) {
    const userHome = (options && options.userHome) || os.homedir();
    const harnessRoot = getAccountHarnessRoot(options);
    const loaded = loadRegistryFromHarnessRoot(harnessRoot);
    return {
        harnessRoot,
        loaded,
        diffs: diffOutputs(userHome, loaded, { harnessRoot })
    };
}

function buildDefaultAccountRegistry() {
    return [
        'version: 0',
        '',
        'meta:',
        '  name: account-harness',
        '  description: Account-wide harness for Claude and Codex environments',
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
    applyAccountOutputs,
    diffAccountOutputs,
    discoverAccountHarness,
    doctorAccountHarness,
    generateAccountOutputs,
    getAccountHarnessRoot,
    initAccountHarness,
    loadAccountRegistry
};
