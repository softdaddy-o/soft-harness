# Nested Link Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow account sync backups to preserve nested Windows junctions instead of failing while copying their containing host directory.

**Architecture:** Replace the `fs.cpSync` delegation in `copyPath` with an `lstat`-based recursive copy. Files retain the existing copy behavior, directories are traversed explicitly, and symbolic links or junctions are recreated as links using their original target and inferred type. Existing backup manifests continue to describe only selected top-level paths.

**Tech Stack:** Node.js 20+, native `node:fs`, `node:test`, `node:assert/strict`.

---

### Task 1: Reproduce nested-link backup failure

**Files:**
- Modify: `test/backup.test.js`
- Reference: `src/backup.js:19-62`
- Reference: `src/fs-util.js:40-46`

- [ ] **Step 1: Write the failing test**

Add a test after the existing top-level symlink restore test. It creates `host/skill`, creates a `shared-references` directory, then creates `host/skill/references` as a junction to it. Back up `host`, delete it, restore the backup, and verify the restored nested path is a symbolic link and resolves to readable content.

```js
test('backup: nested junctions are preserved while copying a parent directory', () => {
    const root = makeTempDir('soft-harness-backup-nested-link-');
    const hostDir = path.join(root, 'host');
    const sharedDir = path.join(root, 'shared-references');
    const nestedLink = path.join(hostDir, 'skill', 'references');
    writeUtf8(path.join(sharedDir, 'guide.md'), '# Shared');
    fs.mkdirSync(path.dirname(nestedLink), { recursive: true });

    try {
        fs.symlinkSync(sharedDir, nestedLink, 'junction');
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') return;
        throw error;
    }

    const backup = createBackup(root, ['host'], { timestamp: '2026-08-23-nested-link', reason: 'test' });
    fs.rmSync(hostDir, { recursive: true, force: true });
    restoreBackup(root, backup.timestamp);

    assert.equal(fs.lstatSync(nestedLink).isSymbolicLink(), true);
    assert.equal(readUtf8(path.join(nestedLink, 'guide.md')), '# Shared');
});
```

- [ ] **Step 2: Run the focused test and observe the failure**

Run: `node --test --test-name-pattern="nested junctions" test/backup.test.js`

Expected: FAIL with `EPERM` from `fs.cpSync` while recreating `references` beneath the backup directory.

- [ ] **Step 3: Commit the failing regression test**

```bash
git add test/backup.test.js
git commit -m "test: cover nested junction backups"
```

### Task 2: Preserve nested links in the shared copy helper

**Files:**
- Modify: `src/fs-util.js:40-46`
- Modify: `src/fs-backend.js:5-17`
- Modify: `test-support/memory-fs.js:8-18,232-260`
- Test: `test/backup.test.js`

- [ ] **Step 1: Replace the recursive `cpSync` call with `copyPathEntry`**

Define a private helper which calls `lstatSync(sourcePath)`. If the entry is a symbolic link, call `readlinkSync(sourcePath)`, infer `junction` for links that resolve to directories and `file` otherwise, and invoke `symlinkSync(linkTarget, targetPath, linkType)`. If it is a directory, create `targetPath`, list its entries, and recursively copy each child. Otherwise call `copyFileSync`.

```js
function copyPath(sourcePath, targetPath) {
    ensureDir(path.dirname(targetPath));
    copyPathEntry(sourcePath, targetPath);
}

function copyPathEntry(sourcePath, targetPath) {
    const backend = getFsBackend();
    const stats = backend.lstatSync(sourcePath);
    if (stats.isSymbolicLink()) {
        const linkTarget = backend.readlinkSync(sourcePath);
        let linkType = 'file';
        try {
            linkType = backend.statSync(sourcePath).isDirectory() ? 'junction' : 'file';
        } catch (error) {
            linkType = 'junction';
        }
        backend.symlinkSync(linkTarget, targetPath, linkType);
        return;
    }
    if (stats.isDirectory()) {
        ensureDir(targetPath);
        for (const entry of backend.readdirSync(sourcePath)) {
            copyPathEntry(path.join(sourcePath, entry), path.join(targetPath, entry));
        }
        return;
    }
    backend.copyFileSync(sourcePath, targetPath);
}
```

- [ ] **Step 2: Ensure every filesystem backend exposes the used primitives**

`src/fs-backend.js` already exposes `lstatSync`; add the missing bound
`copyFileSync` method beside `cpSync`. In `test-support/memory-fs.js`, add a
`copyFileSync` backend method that reads the source entry without following a
link, throws for a non-file source, and writes a copied file entry at the target
path. This keeps virtual-filesystem tests compatible with `copyPath`.

```js
copyFileSync: fs.copyFileSync.bind(fs),
```

- [ ] **Step 3: Run focused backup tests**

Run: `node --test test/backup.test.js`

Expected: all backup tests pass, including the nested-junction regression test.

- [ ] **Step 4: Commit the implementation**

```bash
git add src/fs-util.js src/fs-backend.js test-support/memory-fs.js test/backup.test.js
git commit -m "fix: preserve nested links in backups"
```

### Task 3: Verify integration and retry account organize

**Files:**
- No source changes expected

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`

Expected: exit 0 with no failed tests.

- [ ] **Step 2: Retry account sync with host-authoritative conflict decisions**

Run the sync helper against the account root with `resolveConflict` returning `import`, plugin install/uninstall disabled, and capture its JSON completion report.

Expected: a new backup with `manifest.json`, `phase: "completed"`, and a newer `.harness/.sync-state.json` timestamp.

- [ ] **Step 3: Re-run account analysis read-only**

Run: `node src/cli.js analyze --account --category=skills --json`

Expected: host and harness skill state is readable without the prior nested-link copy error; report residual host-specific items and plugin enablement separately.
