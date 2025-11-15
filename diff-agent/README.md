# Diff Agent

Experimental diff review agent that inspects each changed file in `multi-agent-codex-system` using the Codex native SDK.

## Usage

```
pnpm --filter @codex/diff-agent dev
```

or build and run via Node:

```
pnpm --filter @codex/diff-agent build
node diff-agent/dist/index.js
```

Environment variables:

- `CX_DIFF_AGENT_REPO` (default: `/Volumes/sandisk/codex/multi-agent-codex-system`)
- `CX_DIFF_AGENT_BASE` (default: detected upstream or `main`)
- `CX_DIFF_AGENT_MODEL` (default: `gpt-5.1-codex`)
- `CX_DIFF_AGENT_MAX_FILES` (default: `12`)

The script prints a branch-level intent summary followed by per-file assessments and leverages Reverie search if configured via `CODEX_HOME`.
