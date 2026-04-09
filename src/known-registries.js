const KNOWN_REGISTRIES = {
    'claude-plugins-official': {
        install_cmd_template: 'claude plugin install {package}@{registry}',
        supports_version: true
    },
    'claude-code-plugins': {
        install_cmd_template: 'claude plugin install {package}@{registry}',
        supports_version: false
    }
};

function resolveInstallCmd(source) {
    if (!source || !source.registry || !source.package) {
        return null;
    }

    const definition = KNOWN_REGISTRIES[source.registry];
    if (!definition) {
        return null;
    }

    let command = definition.install_cmd_template
        .replace('{package}', source.package)
        .replace('{registry}', source.registry);

    if (definition.supports_version && source.version) {
        command += `@${source.version}`;
    }

    return command;
}

function isKnownRegistry(registryName) {
    return Object.prototype.hasOwnProperty.call(KNOWN_REGISTRIES, registryName);
}

module.exports = {
    isKnownRegistry,
    resolveInstallCmd
};
