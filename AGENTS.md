# Codex Workspace Agent Guide

## Core Expectations
- Crates in `codex-rs` use the `codex-` prefix (`core` → `codex-core`); keep naming consistent when adding components.
- Install repo helpers (`just`, `rg`, `cargo-insta`, etc.) before running commands that depend on them.
- Sandbox env vars are managed for you: expect `CODEX_SANDBOX_NETWORK_DISABLED=1` on every shell call and `CODEX_SANDBOX=seatbelt` when Seatbelt launches children. Never change the code that checks these flags.
- Style rules: collapse nestable `if`s, inline `format!` arguments, prefer method references over closures, avoid unsigned integers entirely, and compare whole structs (not fields) in tests.
- Update `docs/` whenever you add or modify an API surface so external references stay accurate.

## Build & Test Loop
- After touching Rust inside `codex-rs`, run `just fmt` in that workspace (no approval needed).
- Fix lint/clippy issues with `just fix -p <crate>`; only run `just fix` without `-p` after confirming because it rebuilds the workspace.
- Testing order:
  1. Run crate-specific tests you touched (e.g., `cargo test -p codex-tui`). These never need extra approval.
  2. If you changed shared crates (`codex-common`, `codex-core`, `codex-protocol`, etc.), ask before running `cargo test --all-features`, then run it.
- Quote the exact commands you executed or recommend so the next agent can replay them verbatim.

## TUI Quick Reference
- Default to Stylize helpers (`"text".into()`, `"warn".yellow()`, chaining `.dim().bold()`) instead of manual `Style` construction.
- Prefer concise conversions: spans via `.into()`, lines via `vec![…].into()` unless the API truly requires `Line::from`.
- Never call `.white()`; rely on the default foreground.
- Wrap plain strings with `textwrap::wrap`. For `Line`s use `tui/src/wrapping.rs` helpers (`word_wrap_lines`, `word_wrap_line`) and `prefix_lines` when adding indent/prefix logic.
- Avoid churn between equivalent representations unless it materially improves readability. Consult `codex-rs/tui/styles.md` for palettes and patterns.

## Snapshot & UI Tests
- When UI output changes, run `cargo test -p codex-tui` to regenerate `.snap.new` files.
- Inspect pending differences with `cargo insta pending-snapshots -p codex-tui` (or `cargo insta show …` for a specific file).
- Accept refreshed expectations only when you're certain: `cargo insta accept -p codex-tui`.
- Install `cargo-insta` if it is missing before running these commands.

## Native SDK (`sdk/native`)
- Install deps: `pnpm -C sdk/native install`.
- Build the JS + N-API bundle: `pnpm -C sdk/native run build` (produces the platform `.node` that the loader prefers over optional published binaries).
- Tests: JS via `pnpm -C sdk/native test`, Rust via `cargo test` inside `sdk/native`.
- Approval workflows: expose a handler such as `codex.setApprovalCallback()` or `registerToolInterceptor("__approval__", …)` so the Rust layer can gate shell/file actions.
- For smoke tests you can reuse the same configuration with `codex-native run …` or `codex-native tui`.

## Assertions & Integration Helpers
- Use `pretty_assertions::assert_eq` for clearer diffs in Rust tests.
- Favor `core_test_support::responses` helpers when writing end-to-end tests:
  - Mount SSE streams with `mount_sse_once`/`mount_sse*` helpers and keep the returned `ResponseMock` to inspect POST bodies.
  - Prefer `wait_for_event` over `wait_for_event_with_timeout` and `mount_sse_once` over the match/sequence variants unless required.
  - Assert via helpers such as `ResponsesRequest::function_call_output`, `body_json`, and `query_param` instead of hand-parsing JSON.

## Additional References
- Detailed crate descriptions now live in `docs/crate-overview.md`.
- TUI palette/style guidance: `codex-rs/tui/styles.md`.
- Full provider guidance for the Native SDK lives in `sdk/native/AGENTS.md`.
