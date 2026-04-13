const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getFsBackend, resetFsBackend, setFsBackend, withFsBackend } = require('../src/fs-backend');
const { createMemoryFs } = require('../test-support/memory-fs');

test('fs-backend: set/get/reset swap the active backend', () => {
    const memoryFs = createMemoryFs();
    const root = path.resolve('fs-backend-active-root');
    const originalBackend = getFsBackend();

    setFsBackend(memoryFs.backend);
    try {
        getFsBackend().mkdirSync(root, { recursive: true });
        getFsBackend().writeFileSync(path.join(root, 'note.txt'), 'hello', 'utf8');
        assert.equal(getFsBackend().existsSync(path.join(root, 'note.txt')), true);
    } finally {
        resetFsBackend();
    }

    assert.equal(getFsBackend(), originalBackend);
});

test('fs-backend: async-local override is scoped and falls back to the active backend outside the callback', async () => {
    const activeFs = createMemoryFs();
    const scopedFs = createMemoryFs();
    const activeRoot = activeFs.root('fs-backend-active-scope-root');
    const scopedRoot = scopedFs.root('fs-backend-scoped-root');

    setFsBackend(activeFs.backend);
    try {
        await withFsBackend(scopedFs.backend, async () => {
            getFsBackend().writeFileSync(path.join(scopedRoot, 'inside.txt'), 'scoped', 'utf8');
            assert.equal(activeFs.backend.existsSync(path.join(scopedRoot, 'inside.txt')), false);
            await Promise.resolve();
            assert.equal(getFsBackend().existsSync(path.join(scopedRoot, 'inside.txt')), true);
        });

        getFsBackend().writeFileSync(path.join(activeRoot, 'outside.txt'), 'active', 'utf8');
        assert.equal(activeFs.backend.existsSync(path.join(activeRoot, 'outside.txt')), true);
        assert.equal(scopedFs.backend.existsSync(path.join(activeRoot, 'outside.txt')), false);
    } finally {
        resetFsBackend();
    }
});

test('fs-backend: undefined backend values fall back to the node backend', () => {
    const baseline = getFsBackend();
    setFsBackend(undefined);
    assert.equal(getFsBackend(), baseline);

    const inside = withFsBackend(undefined, () => getFsBackend());
    assert.equal(inside, baseline);
});
