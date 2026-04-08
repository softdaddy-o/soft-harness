#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'harness', 'registry.yaml');

function main() {
    const command = process.argv[2] || 'help';

    switch (command) {
        case 'discover':
            printNotImplemented('discover');
            break;
        case 'doctor':
            printNotImplemented('doctor');
            break;
        case 'migrate':
            printNotImplemented('migrate');
            break;
        case 'generate':
            printRegistryLocation();
            break;
        case 'diff':
            printNotImplemented('diff');
            break;
        case 'apply':
            printNotImplemented('apply');
            break;
        case 'help':
        default:
            printHelp();
            break;
    }
}

function printHelp() {
    console.log('soft-harness');
    console.log('');
    console.log('Commands:');
    console.log('  discover   Scan local Claude/Codex state');
    console.log('  doctor     Report drift, security issues, and gaps');
    console.log('  migrate    Normalize discovered state into the registry');
    console.log('  generate   Generate host-native outputs from the registry');
    console.log('  diff       Show differences between registry and live state');
    console.log('  apply      Apply generated outputs');
}

function printRegistryLocation() {
    const exists = fs.existsSync(REGISTRY_PATH);
    console.log(`Registry: ${REGISTRY_PATH}`);
    console.log(`Exists: ${exists ? 'yes' : 'no'}`);
}

function printNotImplemented(command) {
    console.log(`Command not implemented yet: ${command}`);
    console.log(`Repository root: ${ROOT}`);
}

main();
