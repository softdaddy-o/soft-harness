# Nested Link Backup Design

## Problem

Account-level sync backs up host directories before writing. A host skill can
contain a nested Windows junction to shared material. `copyPath` currently
delegates recursive copying to `fs.cpSync`, which attempts to recreate that
junction while traversing the parent directory and can fail with `EPERM`.

## Decision

Preserve links encountered anywhere in a copied tree as links rather than
following or recreating their targets through `fs.cpSync`. The copy helper will
inspect each source entry with `lstat`, create its parent directory, and create
an equivalent file, directory, or link at the destination. For a relative link,
it will resolve the target against the source link's parent before recreating
the link so copying a tree does not silently retarget an external dependency.
For a link it will infer the appropriate link type, matching the existing
top-level backup/restore convention. A link source replaces an existing target,
preserving the prior `cpSync(..., { force: true })` behavior.

## Scope

The change applies to the shared `copyPath` helper, so backups, exports, and
other callers gain the same safe nested-link behavior. It does not change
hashing, drift semantics, or the content selected for synchronization.

## Verification

Add fixtures with a regular directory that contains a nested junction and a
relative nested link. Assert that `createBackup` succeeds, its backup copy
contains symbolic-link entries at the nested paths, and `restoreBackup`
recreates those links. Also verify that a link source replaces an existing
destination. Skip only when the current platform forbids creating the fixture
link.

Run the focused backup tests and the full test suite before retrying account
sync. The retry must create a complete backup manifest and advance sync state.
