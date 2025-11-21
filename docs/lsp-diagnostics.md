## LSP diagnostics integration

Codex can surface Language Server Protocol (LSP) diagnostics both to the AI agent (via tool outputs) and to the human user in the TUI.

### Agent-visible diagnostics for `read_file`

When you use the Native SDK (`@codex-native/sdk`) and the built-in `read_file` tool:

- A default tool interceptor runs the real `read_file` implementation first.
- It then asks the configured LSP servers for diagnostics for the same file.
- If any diagnostics are returned, Codex prepends a short, human-readable block to the tool output, for example:

```text
LSP diagnostics for /path/to/file.ts:
• /path/to/file.ts
  - [WARNING] Unused variable x (12:5 · tsc)

<original read_file output…>
```

This makes diagnostics visible directly in the agent’s context whenever it reads a file, without requiring a separate “lint this file” tool.

Notes:

- The interceptor only runs when the native binding is available and the built-in `read_file` tool is in use.
- If no diagnostics are found, the tool output is returned unchanged.
- Custom `read_file` overrides still work, but will receive their own output without the built‑in diagnostics prepend.

### TUI visualization of diagnostics

When running the Codex TUI (via the native SDK or the CLI) _or_ the `codex-native run` command, Codex listens for background events that carry LSP diagnostics:

- The Native SDK’s `LspDiagnosticsBridge` watches:
  - File changes emitted as `file_change` items (e.g., after `apply_patch`).
  - MCP `read_file`/`read_file_v2` tool calls.
- After each such event, it:

  - Collects diagnostics for the affected files from LSP servers.
  - Emits a background event whose message starts with:

    ```text
    LSP diagnostics detected:
    • path/to/file
      - [SEVERITY] message (line:col · source)
    ```

In the TUI:

- Background events are rendered in the history as informational cells.
- Messages starting with `LSP diagnostics` (or the bridged `📟 LSP diagnostics` prefix) are highlighted in red, so diagnostics stand out visually in the transcript.
- The Rust TUI (`codex-rs/tui`) also posts a desktop notification when these diagnostics arrive, so you get an OS-level nudge even if the terminal is unfocused.

### Behavior and limitations

- LSP integration relies on the configured workspace and available language servers; if no matching server is found for a file, no diagnostics are attached.
- Diagnostics are collected on demand when:
  - A file is read via tools (`read_file` / MCP file tools), or
  - A patch modifies files and a `file_change` item is emitted.
- Core Rust `read_file` behavior in `codex-rs` remains unchanged; the diagnostics wiring above is layered on top via the Native SDK and background events, without altering the underlying tool protocol.
