# Skill Hash Ignore Design

## Problem

Account-level `soft-harness sync --dry-run` repeatedly hashes every file beneath
each discovered skill. A skill directory can contain a complete Git repository;
the `gstack` directory therefore makes the dry-run exceed the normal command
budget even though version-control metadata and installed dependencies do not
define the skill.

## Decision

Keep content hashing for `SKILL.md` and authored supporting files, while skipping
only universally regenerated or version-control trees:

- `.git`
- `node_modules`
- `__pycache__`
- `.pytest_cache`

The rule applies only to discovered skills. Generic directory hashing remains
unchanged so callers that need a complete tree hash retain current semantics.

## Design

`hashDirectory` will accept its existing optional ignore list for both files and
directories. Skill discovery supplies the standard ignore list when it computes
a skill hash. The ignored directory check occurs before recursion, so no files
inside excluded trees are read.

Changing `SKILL.md` or any non-excluded support file still changes the skill
hash. Changing a file solely in an excluded tree does not.

## Tests

Add fixtures that prove:

1. a skill hash is unchanged after a `.git` or `node_modules` file changes;
2. a support-file change changes the skill hash;
3. discovered skill inventory completes without recursing into ignored trees.

The tests must not use elapsed-time assertions; they verify the traversal
boundary directly and remain deterministic.
