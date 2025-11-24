import { HISTORICAL_PLAYBOOK } from "./constants.js";
import type { ConflictContext, RemoteComparison, RemoteRefs, WorkerOutcome } from "./types.js";
import { limitText } from "./git.js";

export function buildCoordinatorPrompt(snapshot: {
  branch: string | null;
  statusShort: string;
  diffStat: string;
  recentCommits: string;
  conflicts: ConflictContext[];
  remoteComparison?: RemoteComparison | null;
}): string {
  const conflictList =
    snapshot.conflicts
      .map(
        (conflict, idx) =>
          `${idx + 1}. ${conflict.path} (${conflict.language}; markers: ${
            conflict.conflictMarkers ?? "unknown"
          }; lines: ${conflict.lineCount ?? "unknown"})`,
      )
      .join("\n") || "<no conflicts listed>";
  const remoteSection = snapshot.remoteComparison
    ? `Remote divergence (${snapshot.remoteComparison.originRef} ↔ ${snapshot.remoteComparison.upstreamRef})

Commits only on ${snapshot.remoteComparison.upstreamRef}:
${snapshot.remoteComparison.commitsMissingFromOrigin ?? "<none>"}

Commits only on ${snapshot.remoteComparison.originRef}:
${snapshot.remoteComparison.commitsMissingFromUpstream ?? "<none>"}

Diff ${snapshot.remoteComparison.originRef}..${snapshot.remoteComparison.upstreamRef}:
${snapshot.remoteComparison.diffstatOriginToUpstream ?? "<no diff>"}

Diff ${snapshot.remoteComparison.upstreamRef}..${snapshot.remoteComparison.originRef}:
${snapshot.remoteComparison.diffstatUpstreamToOrigin ?? "<no diff>"}`
    : "Remote divergence context: unavailable (refs missing or fetch required).";

  return `# Merge Conflict Orchestrator

Repository branch: ${snapshot.branch ?? "(unknown)"}
Status summary:
${snapshot.statusShort || "<clean>"}

Diffstat:
${snapshot.diffStat || "<no diff>"}

Recent commits:
${snapshot.recentCommits || "<none>"}

Conflicted files:
${conflictList}

${remoteSection}

Historical guardrails:
${HISTORICAL_PLAYBOOK}

Mission:
1. Build a concise plan for how to resolve these conflicts with multiple specialized agents.
2. For each file, describe the most likely source of conflict and what to preserve from our branch vs upstream.
3. Highlight any cross-file coupling (e.g., shared types/interfaces requiring mirrored changes across layers).
4. Provide sequencing guidance plus sanity checks (install/build/ci expectations).

Provide the plan as structured bullet points so downstream workers can pick up easily.`;
}

type WorkerPromptRemotes = {
  originRef?: string | null;
  upstreamRef?: string | null;
};

export function buildWorkerPrompt(
  conflict: ConflictContext,
  coordinatorPlan: string | null,
  remotes?: WorkerPromptRemotes,
): string {
  // Only include git history context - no diffs or content snapshots
  // Agents can run git commands themselves to inspect the conflict
  const researchResources = [
    conflict.localIntentLog
      ? `### Local intent commits (not in upstream)\n${conflict.localIntentLog}`
      : null,
    conflict.recentHistory ? `### Recent git log (last 5 commits)\n${conflict.recentHistory}` : null,
  ]
    .filter((chunk) => chunk && chunk.length)
    .join("\n\n") || "(no supplemental analysis available)";

  const fileInfo = `File: ${conflict.path}
Language: ${conflict.language}
Lines: ${conflict.lineCount ?? "unknown"}
Conflict markers: ${conflict.conflictMarkers ?? "unknown"}`;

  const refInfo = remotes?.originRef && remotes?.upstreamRef
    ? `\nRefs: ${remotes.originRef} (origin) vs ${remotes.upstreamRef} (upstream)`
    : "";

  return `# Merge Conflict Specialist – ${conflict.path}

You are the dedicated agent responsible for resolving the merge conflict in ${conflict.path} (${conflict.language}).

${fileInfo}${refInfo}

${HISTORICAL_PLAYBOOK}

Coordinator guidance:
${coordinatorPlan ?? "(coordinator has not provided additional notes)"}

Research materials:
${researchResources}

Instructions:
- Operate ONLY on ${conflict.path} unless you must touch closely linked files (explain if so).
- Use git commands to understand the conflict:
  * \`git show :1:${conflict.path}\` — merge base
  * \`git show :2:${conflict.path}\` — our version
  * \`git show :3:${conflict.path}\` — their version
  * \`git diff --color=never --unified=1 :1:${conflict.path} :2:${conflict.path}\` — base → ours
  * \`git diff --color=never --unified=1 :1:${conflict.path} :3:${conflict.path}\` — base → theirs
  * \`git diff --color=never --unified=1 :2:${conflict.path} :3:${conflict.path}\` — ours ↔ theirs
- Use \`read_file\` to view the working tree file with conflict markers.
- Start by writing a short \"Three-way summary\" that contrasts Base → Ours, Base → Theirs, and Ours ↔ Theirs; note what each side was trying to achieve and whether they can coexist.
- Do NOT run \`git add\`, \`git merge\`, \`git checkout\`, or touch .git/lock files; the coordinator handles staging/cleanup. If you need staging, just say so in your summary.
- When editing, prefer \`apply_patch\` or structured writes; avoid ad-hoc python/sed that rewrites entire files.
- Preserve intentional local increases (buffer sizes, limits, config tweaks).
- Mirror cross-surface implications (e.g., API definitions ↔ bindings or client ↔ server) if this file participates.
- After resolving the conflict, run \`rg '<<<<<<<' ${conflict.path}\` to ensure markers are gone, then state it is ready for staging (do not run git add yourself).
- Summarize what you kept from each side plus any follow-up commands/tests to run.
- Your shell/file-write accesses are gated by an autonomous supervisor; justify sensitive steps so approvals go through.
- Do not run tests/builds/formatters during this resolution phase; a dedicated validation turn will follow.

Deliverables:
1. **Three-way summary** – bullet the important hunks from Base→Ours, Base→Theirs, and Ours↔Theirs, and call out why each change mattered.
2. **Decision log** – explain how you reconciled the intents, what you kept/removed, and mention any trade-offs or TODOs for follow-up.
3. **Command log** – list every tool/shell/apply_patch invocation you used during this turn.
4. **Validation plan** – recommend targeted tests or checks (cargo/pnpm/etc.) that should run once the conflict is resolved.
5. Confirm that \`git status --short ${conflict.path}\` is staged/clean and rg finds no conflict markers.
6. Use concise diff excerpts when quoting code (prefer read_file output over huge sed dumps).`;
}

export function buildReviewerPrompt(input: {
  status: string;
  diffStat: string;
  remaining: string[];
  workerSummaries: WorkerOutcome[];
  remoteComparison: RemoteComparison | null;
  validationMode?: boolean;
  lspDiagnostics?: string | null;
}): string {
  const workerNotes =
    input.workerSummaries
      .map((outcome) => {
        const status = outcome.success ? "resolved" : "unresolved";
        const summary = outcome.summary ? outcome.summary.slice(0, 2000) : "(no summary)";
        return `- ${outcome.path}: ${status}\n${summary}`;
      })
      .join("\n\n") || "(workers produced no summaries)";
  const remoteSection = input.remoteComparison
    ? `Remote divergence (${input.remoteComparison.originRef} ↔ ${input.remoteComparison.upstreamRef})\nCommits only on ${
        input.remoteComparison.upstreamRef ?? "<none>"
      }\n\nCommits only on ${input.remoteComparison.originRef ?? "<none>"}\n\nDiff ${
        input.remoteComparison.originRef
      }..${input.remoteComparison.upstreamRef}:\n${
        input.remoteComparison.diffstatOriginToUpstream ?? "<no diff>"
      }`
    : "Remote divergence context unavailable.";

  const remainingBlock = input.remaining.length ? input.remaining.join("\n") : "<none>";

  const lspSection = input.lspDiagnostics
    ? `\n## LSP Diagnostics (Post-Resolution)\n\n${input.lspDiagnostics}\n`
    : "";

  return `# Merge Conflict Reviewer

Goal: confirm that all conflicts are resolved, run/plan validation commands, and highlight any follow-ups.

Current git status:
${input.status || "<clean>"}

Diffstat:
${input.diffStat || "<none>"}

Remaining conflicted files (git diff --name-only --diff-filter=U):
${remainingBlock}

Worker notes:
${workerNotes}

${remoteSection}${lspSection}

Historical guardrails to honor:
${HISTORICAL_PLAYBOOK}

Tasks:
0. Do not run git add/merge/reset; only inspect status and report what should be staged.
1. ${
    input.validationMode
      ? "Run targeted tests for each resolved file (unit/integration only)."
      : 'Double-check no conflict markers remain (consider "rg <<<<<<" across repo).'
  }
2. ${
    input.validationMode
      ? "Report pass/fail per file and note any new issues."
      : "Ensure git status is staged/clean as appropriate."
  }
3. ${
    input.validationMode
      ? "List broader suites (pnpm build/ci) to run once targeted checks pass."
      : "If feasible, run pnpm install, pnpm build, and pnpm run ci. If they are too heavy, explain when/how they should run."
  }
4. Summarize final merge state plus TODOs for the human operator.
5. Call out any files that still need manual attention.

Respond with a crisp summary plus checklist.`;
}

export function buildValidationPrompt(path: string, workerSummary: string): string {
  return `# Targeted Validation for ${path}

The merge conflict for ${path} is resolved. Your task now is to run the most relevant tests for this file (unit/integration only). Do not edit code; focus on verifying the fix.

Instructions:
- Identify the smallest set of tests that exercise ${path}.
- Run those tests. Prefer targeted commands (e.g., cargo test -p <crate> -- <filter>, pnpm test -- <file>, etc.).
- If no tests exist, explain why and suggest follow-up coverage.
- Summarize results starting with either "VALIDATION_OK:" or "VALIDATION_FAIL:" followed by details.

Reference summary from the merge agent:
${workerSummary || "(no summary provided)"}

Report:
- What tests you ran (commands/output).
- Whether they passed or failed.
- Any further actions needed.`;
}

export function parseValidationSummary(text: string): { status: "ok" | "fail"; summary: string } {
  const normalized = text.trim();
  const lower = normalized.toLowerCase();
  if (lower.startsWith("validation_ok")) {
    return { status: "ok", summary: normalized };
  }
  if (lower.startsWith("validation_fail")) {
    return { status: "fail", summary: normalized };
  }
  return { status: "fail", summary: normalized || "VALIDATION_FAIL: No output returned" };
}
