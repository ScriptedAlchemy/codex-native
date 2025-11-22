# Codex Agents Suite

Codex Agents Suite bundles our multi-agent workflows into one cohesive toolkit. It combines the rich orchestration from the original `multi-agent-codex-system` project with the focused diff review and merge utilities from `diff-agent`.

## Highlights

- **Interactive launcher** – `pnpm --filter codex-agents-suite start` opens a terminal picker so you can jump into the orchestrator, diff reviewer, merge solver, or CI fixer.
- **Unified configuration** – shared environment helpers (`CODEX_AGENTS_*` variables) keep repo paths, base branches, and models aligned across tools.
- **Reusable subsystems** – orchestrator, diff reviewer, reverie tooling, and CI/merge helpers now live under one package for easier reuse and publishing.

## Quick Start

```bash
pnpm install
pnpm --filter codex-agents-suite start
```

When the menu appears, pick one of the available workflows:

1. **Review & CI Orchestrator** – end-to-end PR review, CI triage, reverie hints, and optional fix application.
2. **Diff Reviewer** – structured diff analysis with reverie enrichment, LSP diagnostics, and per-file risk scoring.
3. **Merge Conflict Solver** – autonomous merge workflow that supervises approval requests and tracks token usage.
4. **CI Auto-Fix Orchestrator** – iterative CI runner that spawns fix agents, validates changes, and re-runs checks.

You can also run the tools directly:

```bash
pnpm --filter codex-agents-suite run run:diff          # Diff reviewer
pnpm --filter codex-agents-suite run run:merge        # Merge solver
pnpm --filter codex-agents-suite run run:ci-fix       # CI fixer
pnpm --filter codex-agents-suite run dev              # Launch orchestrator directly
```

## Environment Variables

The diff reviewer and related utilities respect both legacy `CX_DIFF_AGENT_*` variables and the new `CODEX_AGENTS_*` aliases:

- `CODEX_AGENTS_REPO` – repository to inspect (defaults to the current git root).
- `CODEX_AGENTS_BASE` – base branch for comparisons (`main` by default).
- `CODEX_AGENTS_MODEL` – model for diff analysis (defaults to `gpt-5.1-codex-mini`).
- `CODEX_AGENTS_MAX_FILES` – maximum files to inspect in a single review.

All tools also honor the standard Codex SDK settings (`CODEX_BASE_URL`, `CODEX_API_KEY`, `CODEX_HOME`, etc.).

## Code Structure

- `src/cli.ts` – terminal launcher with menu picker.
- `src/orchestrator.ts` – multi-phase review and CI workflow.
- `src/diff/` – diff reviewer, merge solver, CI fixer, and shared helpers.
- `src/reverie*` – reverie search, quality filtering, and hint injection.
- `tests/` – schema validation, reverie behavior, TUI helpers, and orchestrator tests.

## Building & Testing

```bash
pnpm --filter codex-agents-suite run build
pnpm --filter codex-agents-suite run typecheck
pnpm --filter codex-agents-suite test
```

These scripts compile the suite, ensure type safety, and execute the node test suite.

## Publishing

The package exposes the following binaries after build:

- `codex-agents-suite` – launcher CLI.
- `codex-diff-reviewer` – direct diff review entry point.
- `codex-merge-solver` – merge conflict solver.
- `codex-ci-fixer` – CI orchestrator with fix agents.

Each binary resolves to the compiled output in `dist/`.
