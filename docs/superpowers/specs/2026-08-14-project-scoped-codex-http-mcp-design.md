# Project-Scoped Codex HTTP MCP Design

## Goal

Support project-local Codex MCP definitions in `.codex/config.toml`, including Streamable HTTP servers represented by a URL, while preserving account-level definitions and project-local enable/disable overrides.

## Settings Model

The normalized MCP server model gains an optional `url` field. A server with a non-empty `url` is a complete definition even when it has no command, arguments, or explicit transport. Existing stdio fields remain supported without changing their defaults.

Project-local full Codex definitions are stored in `.harness/settings/llm/codex.yaml` with `scope: project`. Portable and account-level definitions continue to use the existing buckets. Project-only enable/disable entries remain under `mcp_server_overrides`.

## Import and Reconciliation

The settings import phase reads project `.mcp.json` and `.codex/config.toml` alongside the existing instruction and asset imports. An HTTP JSON entry such as:

```json
{
  "mcpServers": {
    "unreal-mcp": {
      "type": "http",
      "url": "http://127.0.0.1:8000/mcp"
    }
  }
}
```

normalizes to a project-scoped Codex definition whose URL is preserved. When `.mcp.json` is the selected project source, its server set replaces the managed project MCP definition set in the Codex harness snapshot. Servers absent from the source are removed from that managed snapshot, allowing export to remove stale Codex TOML sections.

Account-level Codex MCP definitions are not copied into the project snapshot. A project TOML entry containing only `enabled` remains an override of an account definition rather than becoming a full project definition.

## Export

Codex project export rewrites only `[mcp_servers.*]` sections in `.codex/config.toml`. All unrelated root keys and TOML sections remain byte-equivalent apart from surrounding blank-line normalization already performed by the renderer.

URL-based definitions render `url = "..."` and omit empty stdio-only fields such as `command` and `args`. Stdio definitions retain their current output. Project overrides continue to render only `enabled`.

The exported managed server set is authoritative: managed sections for servers removed or replaced in the harness snapshot disappear from `.codex/config.toml`.

## Analysis

JSON and TOML analysis includes `url` in normalized MCP identity and treats URL-only entries as full definitions. Inventory entries retain their source scope so project definitions are distinguishable from account definitions and project overrides.

## Error Handling

Malformed JSON or TOML continues to produce the existing parse-error findings. Import does not silently replace a snapshot from an unparseable source. Unsupported or incomplete definitions remain visible for review rather than being rendered as empty stdio servers.

## Tests

Tests will cover:

- importing `{ type: "http", url: "..." }` from project `.mcp.json`;
- recognizing URL-only project Codex TOML as a full definition;
- preserving project scope in the harness snapshot;
- exporting URL-only definitions to `.codex/config.toml`;
- removing stale managed servers during replacement;
- preserving unrelated TOML content;
- retaining existing stdio definitions and project enable/disable overrides.

