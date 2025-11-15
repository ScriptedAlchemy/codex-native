import { HISTORICAL_PLAYBOOK } from "../merge/constants.js";
import type { RepoSnapshot } from "../merge/types.js";

export type CiFailurePromptInput = {
  targetLabel: string;
  workerSummary?: string;
  ciLog: string;
  snippet?: string;
  failureLabel?: string;
  pathHints?: string[];
  isNewAgent?: boolean;
  planContext?: string;
};

export type CiCoordinatorPromptInput = {
  snapshot: RepoSnapshot;
  attempts: number;
  failingStages: string[];
  remoteComparisonText?: string | null;
};

export function buildCiCoordinatorPrompt(input: CiCoordinatorPromptInput): string {
  const { snapshot, attempts, failingStages, remoteComparisonText } = input;
  const stageLines = failingStages.length
    ? failingStages.map((label, idx) => `${idx + 1}. ${label}`).join("\n")
    : "<none detected yet>";
  const remoteBlock = remoteComparisonText
    ? `Remote comparison:\n${remoteComparisonText}`
    : "Remote comparison unavailable (refs missing or fetch required).";
  return `# CI Remediation Orchestrator (Structured Output Required)

Repository branch: ${snapshot.branch ?? "(unknown)"}
Attempts so far: ${attempts}

Status summary:\n${snapshot.statusShort || "<clean>"}

Diffstat:\n${snapshot.diffStat || "<none>"}

Recent commits:\n${snapshot.recentCommits || "<none>"}

Historical guardrails:\n${HISTORICAL_PLAYBOOK}

Known failing stages/snippets:\n${stageLines}

${remoteBlock}

Mission:
Respond **only** with JSON matching the schema below so the orchestrator can parse and route tasks automatically (no prose before/after the JSON).

Schema:
{
  "summary": "Short explanation of current CI status",
  "tasks": [
    {
      "label": "unique-task-id",
      "owner": "who should run it (name/role)",
      "scope": "subsystem or directory (optional)",
      "commands": ["shell command 1", "shell command 2"],
      "notes": "additional context/risks (optional)",
      "blockedBy": ["other-task-id"]
    }
  ]
}

Guidelines:
- Every command must be executable as written (include cd/just/pnpm prefixes as needed).
- Break work into parallelizable tasks with clear owners and scopes.
- Include validation steps (lint/tests) explicitly in commands.
- Mention couplings/risks in the task "notes" field.
- If no failures exist yet, outline proactive hygiene tasks so engineers know what to run.
- Do **not** wrap the JSON in markdown fences.`;
}

export function buildCiFailurePrompt(input: CiFailurePromptInput): string {
  const {
    targetLabel,
    workerSummary,
    ciLog,
    snippet,
    failureLabel,
    pathHints,
    isNewAgent,
    planContext,
  } = input;
  const introTarget = failureLabel && failureLabel !== targetLabel ? `${targetLabel} (${failureLabel})` : targetLabel;
  const ownershipNote = isNewAgent
    ? "You are a CI specialist picking up this failure for the first time."
    : "Continue from your previous merge context for this path.";
  const hintsBlock = pathHints?.length
    ? `Path/test hints: ${pathHints.join(", ")}`
    : "Path/test hints: (not detected)";
  const snippetBlock = snippet ? `\n\nFocused snippet:\n${snippet}` : "";
  const planBlock = planContext ? `\n\nCoordinator task context:\n${planContext}` : "";
  return `# pnpm run ci regression follow-up – ${introTarget}

${ownershipNote}

Previous merge summary:
${workerSummary && workerSummary.trim().length ? workerSummary : "(no summary provided)"}

${hintsBlock}${snippetBlock}${planBlock}

Full pnpm run ci digest (prefix + summaries):
${ciLog || "(no log output captured)"}

Context requirements:
- Capture a quick three-way diff before changing anything:
  - \`git show origin/main -- <path>\` for the upstream/main view.
  - \`git show origin/HEAD -- <path>\` (or your remote tracking branch) for the remote branch view.
  - \`git show HEAD -- <path>\` for the local view.
- If the failure spans multiple files/tests, repeat for each relevant path. This ensures every fix considers upstream intent, the remote branch state, and local edits.

Tasks:
1. Use the snippet and hints to determine the failing stage/test/module and summarize the **Root Cause**.
2. Under **Fix Plan**, describe the precise change(s) required (files, commands, config tweaks) and who should implement them.
3. Under **Validation**, list the exact commands/tests to run (e.g., \`cargo test -p foo\`, \`pnpm --filter bar test\`) and any gating conditions.
4. Flag cross-cutting risks or required follow-ups under **Risks & Handoffs** (e.g., "needs sdk/native mirror patch").
5. If this failure belongs to another subsystem, explicitly recommend reassignment and explain why.

Structure your response with the headings **Root Cause**, **Fix Plan**, **Validation**, and **Risks & Handoffs** so the orchestrator can quickly route actions.`;
}
