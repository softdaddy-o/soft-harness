const test = require('node:test');
const assert = require('node:assert/strict');
const { isKnownRegistry, resolveInstallCmd } = require('../src/known-registries');

test('resolveInstallCmd generates marketplace command', () => {
    assert.equal(
        resolveInstallCmd({
            registry: 'claude-plugins-official',
            package: 'superpowers'
        }),
        'claude plugin install superpowers@claude-plugins-official'
    );
});

test('resolveInstallCmd appends version for registries that support pinning', () => {
    assert.equal(
        resolveInstallCmd({
            registry: 'claude-plugins-official',
            package: 'superpowers',
            version: '5.0.7'
        }),
        'claude plugin install superpowers@claude-plugins-official@5.0.7'
    );
});

test('resolveInstallCmd ignores version for registries without version support', () => {
    assert.equal(
        resolveInstallCmd({
            registry: 'claude-code-plugins',
            package: 'demo-plugin',
            version: '1.0.0'
        }),
        'claude plugin install demo-plugin@claude-code-plugins'
    );
});

test('resolveInstallCmd returns null for unknown registry or null source', () => {
    assert.equal(resolveInstallCmd(null), null);
    assert.equal(resolveInstallCmd({ registry: 'unknown', package: 'demo' }), null);
});

test('isKnownRegistry reflects configured registries', () => {
    assert.equal(isKnownRegistry('claude-plugins-official'), true);
    assert.equal(isKnownRegistry('made-up-registry'), false);
});
