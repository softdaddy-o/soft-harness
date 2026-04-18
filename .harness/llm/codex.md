# AGENTS.md

Repository instructions for `soft-harness`.

## Codex-Specific Notes

- Treat the plugin wrappers and skill content as the primary product surface.
- Treat `src/cli.js` and legacy `sync/prompt/import` flows as internal debug helpers unless a task explicitly targets them.
- Treat `analyze` and `organize` as the real user-facing workflow.
- When updating repo instructions, edit `.harness/` sources and regenerate derived host files instead of editing `AGENTS.md` directly.
- Prefer changes that preserve dual-wrapper parity between `.claude-plugin` and `.codex-plugin`.
