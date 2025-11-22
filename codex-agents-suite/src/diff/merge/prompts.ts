import { HISTORICAL_PLAYBOOK } from "./constants.js";
import type { ConflictContext, RemoteComparison, RemoteRefs, WorkerOutcome } from "./types.js";

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

  return `# Plan the Merge Resolution

We have merge conflicts to resolve. Let's build a plan.

## Repo state
Branch: ${snapshot.branch ?? "(unknown)"}
${snapshot.statusShort ? `Status:\n${snapshot.statusShort}\n` : ""}${
    snapshot.diffStat ? `Changes:\n${snapshot.diffStat}\n` : ""
  }${snapshot.recentCommits ? `Recent commits:\n${snapshot.recentCommits}\n` : ""}
## Files with conflicts
${conflictList}

${remoteSection}

${HISTORICAL_PLAYBOOK}

## What I need from you
Create a resolution plan covering:

1. **Per-file strategy**: For each conflict, what's likely the issue? What should we keep from our branch vs upstream?
2. **Cross-file dependencies**: Any shared types/interfaces that need consistent changes across files?
3. **Sequencing**: Should some files be resolved before others?
4. **Validation**: What should we run after? (install/build/tests)

Keep it concise - use bullet points. Workers will use this as guidance.`;
}

type WorkerPromptRemotes = {
  originRef?: string | null;
  upstreamRef?: string | null;
};

export function buildWorkerPrompt(
  conflict: ConflictContext,
  coordinatorPlan: string | null,
  remotes?: WorkerPromptRemotes,
  supervisorFeedback?: string | null,
): string {
  const sections = [
    conflict.diffExcerpt ? `## Diff excerpt\n${conflict.diffExcerpt}` : null,
    conflict.workingExcerpt ? `## Working tree excerpt (with conflict markers)\n${conflict.workingExcerpt}` : null,
    conflict.oursExcerpt ? `## Ours branch content snapshot\n${conflict.oursExcerpt}` : null,
    conflict.theirsExcerpt ? `## Upstream content snapshot\n${conflict.theirsExcerpt}` : null,
    conflict.baseExcerpt ? `## Merge base snapshot\n${conflict.baseExcerpt}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const analysisSections = [
    conflict.baseVsOursDiff ? `### Base → Ours diff\n${conflict.baseVsOursDiff}` : null,
    conflict.baseVsTheirsDiff ? `### Base → Theirs diff\n${conflict.baseVsTheirsDiff}` : null,
    conflict.oursVsTheirsDiff ? `### Ours ↔ Theirs diff\n${conflict.oursVsTheirsDiff}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const remoteSections = [
    conflict.originRefContent && remotes?.originRef
      ? `## ${remotes.originRef} content preview\n${conflict.originRefContent}`
      : null,
    conflict.upstreamRefContent && remotes?.upstreamRef
      ? `## ${remotes.upstreamRef} content preview\n${conflict.upstreamRefContent}`
      : null,
    conflict.originVsUpstreamDiff && remotes?.originRef && remotes?.upstreamRef
      ? `## ${remotes.originRef} ↔ ${remotes.upstreamRef} diff for ${conflict.path}\n${conflict.originVsUpstreamDiff}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");
  const combinedContext = [sections, remoteSections].filter((chunk) => chunk && chunk.length).join("\n\n");
  const researchResources = [
    analysisSections ? `## Three-way diff snapshots\n${analysisSections}` : null,
    conflict.localIntentLog
      ? `### Local intent commits (not in upstream)\n${conflict.localIntentLog}`
      : null,
    conflict.recentHistory ? `### Recent git log (last 5 commits)\n${conflict.recentHistory}` : null,
  ]
    .filter((chunk) => chunk && chunk.length)
    .join("\n\n") || "(no supplemental analysis available)";

  const feedbackSection = supervisorFeedback
    ? `\n\n## Supervisor feedback (mandatory to address)\n${supervisorFeedback}`
    : "";

  const guidelines = supervisorFeedback
    ? `## Your task
Apply the supervisor feedback to resolve ${conflict.path}. Focus on implementing the edits and clearing conflict markers.

Key points:
- Work only on ${conflict.path} (mention if you need to touch related files)
- Use \`read_file\` and \`apply_patch\` for edits
- Preserve intentional local changes (buffer sizes, limits, config values)
- Avoid running git merge/checkout or touching .git files`
    : `## Your task
Resolve the merge conflict in ${conflict.path} by integrating changes from both branches.

Key points:
- Examine the three-way diff (Base → Ours, Base → Theirs, Ours ↔ Theirs)
- Understand what each side was trying to achieve
- Use \`read_file\` and \`apply_patch\` for edits (avoid sed/awk for large rewrites)
- Keep intentional local increases (buffer sizes, timeouts, limits)
- Ensure type/interface consistency across the file
- Work only on ${conflict.path} (mention if you need to touch related files)
- Avoid running git merge/checkout or touching .git files

Available context:
- \`git show :1:${conflict.path}\` = merge base
- \`git show :2:${conflict.path}\` = our branch
- \`git show :3:${conflict.path}\` = their branch`;

  return `# Merge Conflict Resolver

You're resolving the merge conflict in **${conflict.path}** (${conflict.language}).

${HISTORICAL_PLAYBOOK}

${coordinatorPlan ? `## Coordinator notes\n${coordinatorPlan}\n` : ""}${guidelines}

## Context provided
${combinedContext || "(no file excerpts available)"}${feedbackSection}

## Research materials
${researchResources}

## What to deliver
1. Apply your edits using \`apply_patch\` or file write tools
2. Run: \`rg '<<<<<<<' ${conflict.path}\` to verify no markers remain
3. Run: \`git add ${conflict.path}\` to stage the resolved file
4. Provide a 2-line summary of what you integrated

Complete ALL steps in this single response. Don't wait for confirmation.`;
}

export function buildReviewerPrompt(input: {
  status: string;
  diffStat: string;
  remaining: string[];
  workerSummaries: WorkerOutcome[];
  remoteComparison: RemoteComparison | null;
  validationMode?: boolean;
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

  return `# Review Merge Resolution

Let's verify everything is ready.

## Current state
${input.status ? `Git status:\n${input.status}\n` : ""}${
    input.diffStat ? `Diffstat:\n${input.diffStat}\n` : ""
  }${remainingBlock !== "<none>" ? `Files still conflicted:\n${remainingBlock}\n` : ""}
## What workers did
${workerNotes}

${remoteSection ? `## Remote info\n${remoteSection}\n` : ""}${HISTORICAL_PLAYBOOK}

## Your tasks
${
  input.validationMode
    ? `1. Run targeted tests for each resolved file
2. Report pass/fail and any new issues
3. List broader test suites to run next (pnpm build/ci)`
    : `1. Run "rg <<<<<<" to check for any remaining conflict markers
2. Check git status - make sure all resolved files are staged (run git add if needed)
3. Run pnpm install to update dependencies
4. Run pnpm build to verify the project compiles without errors
5. Try running pnpm run ci if build succeeds (or explain if tests should wait)`
}
6. Summarize the merge state, build status, and any TODOs
7. Call out files needing manual attention

Keep it concise.`;
}

export function buildValidationPrompt(path: string, workerSummary: string): string {
  return `# Test the Fix

The conflict in ${path} is resolved. Now let's verify it works.

${workerSummary ? `What was changed:\n${workerSummary}\n` : ""}
Your task:
1. Find the most relevant tests for ${path}
2. Run them (unit/integration only - use targeted commands like cargo test -p <crate> -- <filter>)
3. Report results

Start your response with either "VALIDATION_OK:" or "VALIDATION_FAIL:" followed by details.

If no tests exist, explain why and suggest coverage that should be added.`;
}

export function buildVerificationPrompt(path: string): string {
  return `Great! Now let's verify the resolution is complete.

Run these checks:
1. \`rg '<<<<<<<' ${path}\` - make sure no conflict markers remain
2. \`git diff --name-only --diff-filter=U | grep ${path}\` - check if git still sees this as conflicted

Report what you find.`;
}

export function buildQuickVerificationPrompt(path: string): string {
  return `Check if ${path} is resolved:

1. Run: \`rg '<<<<<<<' ${path}\`
2. Run: \`git diff --name-only --diff-filter=U | grep ${path}\`

Reply with:
- "VERIFIED_CLEAN" if no markers found and git shows no conflict
- "STILL_CONFLICTED" if markers exist or git shows conflict
- Include the command outputs`;
}

export function buildStagingPrompt(path: string): string {
  return `Perfect! The conflict is resolved. Now stage the file:

Run: \`git add ${path}\`

Then confirm with: \`git status --short ${path}\`

Let me know when it's staged.`;
}

export function buildQuickStagingPrompt(path: string): string {
  return `Stage the resolved file:

Run: \`git add ${path} && git status --short ${path}\`

Reply with:
- "STAGED" if successful
- Include the git status output`;
}

export function buildPerFileReviewPrompt(conflict: ConflictContext, outcome: WorkerOutcome): string {
  const status = outcome.success ? "resolved" : "still conflicted";
  const changedLabel = outcome.changed ? "edits were applied" : "no edits were applied";
  const workerSummary = outcome.summary ?? "(worker provided no summary)";

  const contextSections = [
    conflict.workingExcerpt ? `## Current working tree\n${conflict.workingExcerpt}` : null,
    conflict.baseExcerpt ? `## Base\n${conflict.baseExcerpt}` : null,
    conflict.oursExcerpt ? `## Ours\n${conflict.oursExcerpt}` : null,
    conflict.theirsExcerpt ? `## Theirs\n${conflict.theirsExcerpt}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return `# Review Failed Attempt

The worker tried to resolve ${conflict.path} but it's still ${status}. ${changedLabel}.

## What the worker said
${workerSummary}

## File context
${contextSections || "(no context available)"}

## Your job
Figure out why it's still conflicted and give concrete guidance for the next attempt.

1. What exactly is wrong? (leftover markers? duplicated code? missing changes?)
2. What specific edits are needed? (be precise - line numbers, blocks)
3. Can you sketch an apply_patch that would fix it?

Start with "FEEDBACK:" then provide actionable guidance. Keep it short and specific.`;
}

export function buildOursAnalysisPrompt(conflict: ConflictContext): string {
  return `# Analyze Our Branch Changes

Quick analysis needed for ${conflict.path}.

## Base version
${conflict.baseExcerpt || "(not available)"}

## Our version
${conflict.oursExcerpt || "(not available)"}

## Base → Ours diff
${conflict.baseVsOursDiff || "(not available)"}

What did we change and why? Give me:
1. Key modifications (2-3 bullets max)
2. Intent behind changes
3. Any dependencies or side effects

Keep it concise - just the essential insights.`;
}

export function buildTheirsAnalysisPrompt(conflict: ConflictContext): string {
  return `# Analyze Their Branch Changes

Quick analysis needed for ${conflict.path}.

## Base version
${conflict.baseExcerpt || "(not available)"}

## Their version
${conflict.theirsExcerpt || "(not available)"}

## Base → Theirs diff
${conflict.baseVsTheirsDiff || "(not available)"}

What did they change and why? Give me:
1. Key modifications (2-3 bullets max)
2. Intent behind changes
3. Any dependencies or side effects

Keep it concise - just the essential insights.`;
}

export function buildIntentAnalysisPrompt(conflict: ConflictContext): string {
  return `# Analyze Commit Intent

Quick analysis of why we diverged on ${conflict.path}.

## Recent history
${conflict.recentHistory || "(not available)"}

## Local commits (not in upstream)
${conflict.localIntentLog || "(not available)"}

What was our local intent? Give me:
1. Why did we modify this file?
2. What problem were we solving?
3. Any important context from commit messages?

2-3 bullets max.`;
}

export function buildIntegrationPrompt(
  conflict: ConflictContext,
  oursAnalysis: string,
  theirsAnalysis: string,
  intentAnalysis: string
): string {
  return `# Integrate the Changes

Now merge both sets of changes for ${conflict.path}.

## Analysis from parallel threads

**Our changes:**
${oursAnalysis}

**Their changes:**
${theirsAnalysis}

**Our intent:**
${intentAnalysis}

## Current conflicted file
${conflict.workingExcerpt || "(not available)"}

Your task:
1. Explain how to reconcile both changes
2. Apply the integrated edits using \`apply_patch\`
3. Ensure both intents are preserved where possible

Go ahead and resolve it.`;
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
