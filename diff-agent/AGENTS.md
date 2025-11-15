# Diff-Agent Orchestration Guide

## Overview
The diff-agent package hosts the merge solver, CI remediation prompts, and the standalone `ci-runner-cli`. All CI coordination now relies on **structured output** so orchestration can route work in a fully automated way. This file captures the conventions and guardrails that the coordinators and specialists must follow.

## Structured Coordinator Output
- The CI coordinator prompt (`diff-agent/src/ci/prompts.ts`) **must respond with JSON only**. The schema is:
  ```json
  {
    "summary": "status string",
    "tasks": [
      {
        "label": "unique-task-id",
        "owner": "name/role",
        "scope": "subsystem",
        "commands": ["command 1", "command 2"],
        "notes": "optional context",
        "blockedBy": ["other-task-id"]
      }
    ]
  }
  ```
- Each task is routed automatically to a specialist thread. Do **not** include prose outside the JSON block.
- Commands must be executable verbatim (`cd … && just fmt`, `pnpm --filter diff-agent test`, etc.).

## Worker Prompts
- Worker prompts now reference both the CI log snippet **and** the matching task context.
- Every worker must:
  1. Capture a three-way diff (`git show origin/main -- file`, `git show origin/HEAD -- file`, `git show HEAD -- file`).
  2. Report under the headings **Root Cause**, **Fix Plan**, **Validation**, **Risks & Handoffs**.
  3. Quote the commands they executed and the commands they recommend running next.
- Structured payloads (failures + plan tasks) are encoded via [ToON](https://github.com/toon-format/toon). Keep payloads concise so logs remain readable.

## `ci-runner-cli`
- Located at `diff-agent/src/ci-runner-cli.ts`.
- Usage:
  ```
  pnpm --filter diff-agent exec tsx src/ci-runner-cli.ts [options]
  ```
- Options:
  - `--max-iterations <n|inf>`: rerun `pnpm run ci:json` until success (defaults to ∞).
  - `--ci-command "cmd args"`: override the CI command (defaults to `pnpm run ci:json`). Quoted strings are supported.
- The CLI always resolves the repository root, enforces structured planning, and prints task assignments for each iteration.

## CI Workflow Expectations
1. `pnpm run ci:json` generates `.codex-ci/ci-report.json` plus a `CI_JSON_REPORT …` log line containing the ToON payload.
2. `CiWorkflowRunner` parses that report and the coordinator’s JSON plan, then dispatches multiple workers in parallel.
3. Specialists must adhere to repo-wide rules (format with `just fmt`, run targeted `just fix -p <crate>`, get approval before `cargo test --all-features`, etc.).
4. After fixes land, rerun `pnpm run ci:json` and confirm the coordinator plan is empty before exiting.

Following these rules keeps the diff-agent orchestrator predictable and fully automatable.
