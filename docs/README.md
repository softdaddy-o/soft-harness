# Docs Guide

Use this folder as a focused companion to the root [`README.md`](../README.md), not as a replacement for it.

## Read Order

If you are new to the repo, read these files in this order:

1. [`../README.md`](../README.md)
2. [`plugin-architecture.md`](./plugin-architecture.md)
3. [`vision.md`](./vision.md)
4. [`publishing.md`](./publishing.md) when the task is about release flow

If you are an LLM helping with this repository, also read:

1. [`../plugins/soft-harness/skills/analyze/SKILL.md`](../plugins/soft-harness/skills/analyze/SKILL.md)
2. [`../plugins/soft-harness/skills/organize/SKILL.md`](../plugins/soft-harness/skills/organize/SKILL.md)

## Source Priority

When documents disagree, treat the sources in this order:

1. Real host files and current repo state
2. [`../README.md`](../README.md)
3. Current skill docs under [`../plugins/soft-harness/skills`](../plugins/soft-harness/skills)
4. Current architecture docs in this folder
5. Historical design notes under [`superpowers/`](./superpowers/)

Dated design docs under `docs/superpowers/` are useful for rationale, but they are not the first source of truth for current behavior.

## Fast LLM Handoff

If your LLM can read repo files directly, give it this prompt:

```text
Read these files first, in order:
1. README.md
2. docs/plugin-architecture.md
3. plugins/soft-harness/skills/analyze/SKILL.md
4. plugins/soft-harness/skills/organize/SKILL.md

Then inspect the current repository and help me with this task:
[describe your task here]

Constraints:
- Treat README.md as the primary product guide.
- Treat docs/superpowers as historical context unless needed for rationale.
- Do not invent product behavior that is not supported by the current repo.
- If behavior is unclear, quote the file path that supports your conclusion.
```

If your LLM cannot read files directly, attach or paste at least these files:

- `README.md`
- `docs/plugin-architecture.md`
- `plugins/soft-harness/skills/analyze/SKILL.md`
- `plugins/soft-harness/skills/organize/SKILL.md`

Then use this prompt:

```text
Use the attached README and skill docs as the authoritative context for this repository.
Follow the documented product model and workflow instead of making assumptions.
If the docs conflict, prioritize README.md first, then current skill docs, then architecture docs.

Task:
[describe your task here]
```

## Dogfooding The Docs Folder

If the goal is specifically to improve or reorganize `docs/`, use a tighter prompt:

```text
Read README.md first, then docs/plugin-architecture.md, then inspect the docs/ folder.
Help me dogfood the documentation for this repository.

Rules:
- Keep the docs aligned with README.md and current plugin skills.
- Prefer adding a clear entrypoint or fixing contradictions over writing more theory.
- Treat docs/superpowers as historical material unless I explicitly ask for design archaeology.
- Call out missing indexes, stale docs, duplicated concepts, and unclear read order.
- If you edit docs, keep them concise and concrete.
```

## Folder Map

- [`plugin-architecture.md`](./plugin-architecture.md): current plugin-first model
- [`vision.md`](./vision.md): product goal and non-goals
- [`publishing.md`](./publishing.md): npm publishing setup
- [`roadmap.md`](./roadmap.md): short forward-looking work list
- [`schema-v0.md`](./schema-v0.md): older schema-era reference
- [`superpowers/`](./superpowers/): dated plans and specs for historical context
