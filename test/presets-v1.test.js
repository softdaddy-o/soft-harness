const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveOutputPresets } = require('../src/presets');

test('project-claude preset resolves to direct apply_path', () => {
    const output = resolveOutputPresets({ id: 'foo', preset: 'project-claude' });
    assert.equal(output.target, 'claude');
    assert.equal(output.scope, 'project');
    assert.equal(output.content_type, 'guide-bundle');
    assert.equal(output.apply_path, '../CLAUDE.md');
    assert.equal(output.apply_mode, undefined);
    assert.equal(output.generated_path, undefined);
});

test('project-codex preset resolves to direct apply_path', () => {
    const output = resolveOutputPresets({ id: 'foo', preset: 'project-codex' });
    assert.equal(output.target, 'codex');
    assert.equal(output.apply_path, '../AGENTS.md');
    assert.equal(output.apply_mode, undefined);
});

test('account presets resolve to userHome targets', () => {
    const claude = resolveOutputPresets({ id: 'foo', preset: 'account-claude' });
    const codex = resolveOutputPresets({ id: 'bar', preset: 'account-codex' });
    assert.equal(claude.apply_path, '{userHome}/.claude/CLAUDE.md');
    assert.equal(codex.apply_path, '{userHome}/AGENTS.md');
});

test('legacy stub presets resolve as aliases and are flagged', () => {
    const output = resolveOutputPresets({ id: 'foo', preset: 'project-claude-stub' });
    assert.equal(output.target, 'claude');
    assert.equal(output._legacy_stub, true);
    assert.equal(output.generated_path, undefined);
});

test('project-mcp preset resolves to mcp-json output', () => {
    const output = resolveOutputPresets({ id: 'foo', preset: 'project-mcp' });
    assert.equal(output.content_type, 'mcp-json');
    assert.equal(output.apply_path, '../.mcp.json');
});
