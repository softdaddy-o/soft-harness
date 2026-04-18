# CLAUDE.md

Repository instructions for `soft-harness`.

## Claude-Specific Notes

- Treat the plugin wrappers and skill content as the primary product surface.
- Treat `analyze` and `organize` as the real user-facing workflow.
- Treat `src/cli.js` and legacy `sync/prompt/import` flows as internal debug helpers unless a task explicitly targets them.
- When adding or changing durable guidance, update `.harness/` sources and regenerate derived host files instead of editing `CLAUDE.md` directly.
- Keep Claude wrapper changes aligned with the shared plugin core under `plugins/soft-harness/`.
