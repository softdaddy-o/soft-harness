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

The rule is owned by a private `SKILL_DISCOVERY_HASH_IGNORES` constant in
`src/skills.js` and is passed only by `discoverSkillsAndAgents`. Generic
directory hashing remains unchanged, as do copying, import/export, and managed
tree equality checks. This avoids treating an ignored dependency cache as if it
were absent from a copied skill.

## Design

`hashDirectory` will accept its existing optional ignore list for both files and
directories. Skill discovery supplies the standard ignore list when it computes
a skill hash. Matching is by directory-entry basename at every nesting level;
the ignored-directory check occurs before recursion, so no files inside excluded
trees are read. Existing `Dirent` behavior does not recurse through symbolic
links or junctions, and this change must preserve that behavior.

Changing `SKILL.md` or any non-excluded support file still changes the skill
hash. Changing a file solely in an excluded tree does not.

## Tests

Add fixtures that prove:

1. a skill hash is unchanged after a `.git` or `node_modules` file changes;
2. ignored files added to and removed from nested excluded directories leave the
   skill hash unchanged;
3. a non-excluded support-file change changes the skill hash;
4. discovered skill inventory completes without recursing into ignored trees;
5. generic `hashDirectory` calls still hash ignored-name directories unless a
   caller explicitly supplies an ignore list.

The tests must not use elapsed-time assertions; they verify the traversal
boundary directly and remain deterministic.
