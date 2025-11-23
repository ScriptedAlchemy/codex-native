# Agent Merge Workflow Architecture

```
Snapshot → Coordinator → Workers (parallel simple) → OpenCode (complex/fallback) → Reviewer (+Validation)
                             │
                             └─ ApprovalSupervisor (context from coordinator plan/status)
```

## Components
- **Coordinator Agent**: Builds a global merge plan from repo snapshot (conflicts, remote comparison). Customizable instructions via config.
- **Worker Agents**: Resolve conflicts with dynamic model selection (severity + matchers). Honor approvalMode. Custom instructions supported.
- **OpenCode Runner**: Tool-capable Codex thread for complex/unresolved conflicts; success only when git shows the file is clean.
- **Reviewer Agent**: Summarizes outcomes using live git status/diffstat/remaining; runs again in validation mode after success.
- **Approval Supervisor**: Separate thread; receives coordinator plan/status context; gates commands when approvalMode requires.

## Concurrency & Locking
- Simple conflicts run with `maxConcurrentSimpleWorkers`.
- Per-path locking (`pathLocks`) prevents concurrent edits of the same file across workers/complex flow.
- Complex conflicts processed sequentially (can be parallelized cautiously later).

## Configuration
- `approvalMode`, `sandboxMode`, model choices, matchers, `maxConcurrentSimpleWorkers`.
- `openCodeSeverityThreshold` decides when to route to OpenCode.
- Optional custom instructions for coordinator/worker/reviewer/supervisor.

## Resolution Rules
1) Worker succeeds only if git reports the conflict path is cleared.
2) OpenCode fallback runs with approval callbacks; success requires git-clean path.
3) Overall success requires zero remaining conflicts; then validation-mode reviewer runs.

## TODO / Future Work
- End-to-end integration tests for the orchestrator.
- Optionally fork supervisor from coordinator thread state (when thread forking is exposed).
- Richer tool-enabled worker edits and command execution paths.
- Additional benchmarks and migration notes from the legacy solver.
