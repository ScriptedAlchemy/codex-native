#!/usr/bin/env node

/**
 * Merge Conflict Solver
 *
 * Automates a multi-agent workflow for resolving Git merge conflicts using the
 * Codex Native SDK. The script:
 *   1. Discovers conflicted files and captures contextual metadata/diffs
 *   2. Launches a coordinator thread to build a global merge strategy
 *   3. Spawns a focused worker thread for each conflicting file
 *   4. Shares progress updates back to the coordinator so other agents stay informed
 *   5. Runs a final reviewer thread to verify the merge and outline follow-ups
 *
 * Historical guardrails come from session 019a8536-2265-7353-8669-7451ddaa2855,
 * where the user stressed minimal, intentional merges, mirroring SDK changes
 * between TypeScript and native bindings, and preserving prior buffer increases.
 *
 * Usage:
 *   Edit CONFIG below as needed, then run:
 *     pnpm exec tsx merge-conflict-solver.ts
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import {
  Codex,
  type Thread,
  type ThreadOptions,
  type ApprovalMode,
  type SandboxMode,
} from "@codex-native/sdk";

const execFileAsync = promisify(execFile);

const DEFAULT_COORDINATOR_MODEL = "gpt-5-codex";
const DEFAULT_WORKER_MODEL = "gpt-5-codex-mini";
const DEFAULT_REVIEWER_MODEL = "gpt-5-codex";
const DEFAULT_SANDBOX_MODE: SandboxMode = "workspace-write";
const DEFAULT_APPROVAL_MODE: ApprovalMode = "on-request";
const MAX_CONTEXT_CHARS = 5000;

const HISTORICAL_PLAYBOOK = `Session 019a8536-2265-7353-8669-7451ddaa2855 surfaced the following merge heuristics:
- Inspect each conflicting file to understand what our branch changed versus upstream before editing anything.
- Keep merges minimally invasive when replaying them; prefer integrating upstream intent instead of rewriting our local work.
- If sdk/typescript changes ripple through platform bindings, mirror the necessary adjustments in sdk/native during the same pass.
- Preserve intentional resource/size increases (buffers, limits, etc.) that we previously raised unless upstream explicitly supersedes them.
- Announce resolved files so parallel agents know which conflicts remain and what decisions were made.
- After conflicts are resolved, run pnpm install, pnpm build, and pnpm run ci (or at least outline how/when those checks will run).`;

type SolverConfig = {
  workingDirectory: string;
  coordinatorModel: string;
  workerModel: string;
  reviewerModel: string;
  sandboxMode: SandboxMode;
  approvalMode: ApprovalMode;
  baseUrl?: string;
  apiKey?: string;
  skipGitRepoCheck: boolean;
  originRef?: string | null;
  upstreamRef?: string | null;
};

const CONFIG: SolverConfig = {
  workingDirectory: process.cwd(),
  coordinatorModel: DEFAULT_COORDINATOR_MODEL,
  workerModel: DEFAULT_WORKER_MODEL,
  reviewerModel: DEFAULT_REVIEWER_MODEL,
  sandboxMode: DEFAULT_SANDBOX_MODE,
  approvalMode: DEFAULT_APPROVAL_MODE,
  baseUrl: process.env.CODEX_BASE_URL,
  apiKey: process.env.CODEX_API_KEY,
  skipGitRepoCheck: false,
  originRef: "origin/main",
  upstreamRef: "upstream/main",
};

type RepoSnapshot = {
  branch: string | null;
  statusShort: string;
  diffStat: string;
  recentCommits: string;
  conflicts: ConflictContext[];
  remoteComparison?: RemoteComparison | null;
};

type ConflictContext = {
  path: string;
  language: string;
  lineCount: number | null;
  conflictMarkers: number | null;
  diffExcerpt: string | null;
  workingExcerpt: string | null;
  baseExcerpt: string | null;
  oursExcerpt: string | null;
  theirsExcerpt: string | null;
  originRefContent?: string | null;
  upstreamRefContent?: string | null;
  originVsUpstreamDiff?: string | null;
};

type RemoteComparison = {
  originRef: string;
  upstreamRef: string;
  commitsMissingFromOrigin: string | null;
  commitsMissingFromUpstream: string | null;
  diffstatOriginToUpstream: string | null;
  diffstatUpstreamToOrigin: string | null;
};

type RemoteRefs = {
  originRef?: string | null;
  upstreamRef?: string | null;
};

type WorkerOutcome = {
  path: string;
  success: boolean;
  summary?: string;
  threadId?: string;
  error?: string;
};

class GitRepo {
  constructor(private readonly cwd: string) {}

  async runGit(args: string[], allowFailure = false): Promise<{ stdout: string; stderr: string }> {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, { cwd: this.cwd });
      return { stdout: stdout.toString(), stderr: stderr.toString() };
    } catch (error: any) {
      if (allowFailure && error?.stdout) {
        return { stdout: error.stdout.toString(), stderr: error.stderr?.toString() ?? "" };
      }
      throw error;
    }
  }

  async listConflictPaths(): Promise<string[]> {
    const { stdout } = await this.runGit(["diff", "--name-only", "--diff-filter=U"]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  }

  async getStatusShort(): Promise<string> {
    const { stdout } = await this.runGit(["status", "--short"], true);
    return stdout.trim();
  }

  async getDiffStat(): Promise<string> {
    const { stdout } = await this.runGit(["diff", "--stat", "--color=never"], true);
    return stdout.trim();
  }

  async getRecentCommits(limit = 6): Promise<string> {
    const { stdout } = await this.runGit(["log", `-${limit}`, "--oneline"], true);
    return stdout.trim();
  }

  async getBranchName(): Promise<string | null> {
    const { stdout } = await this.runGit(["rev-parse", "--abbrev-ref", "HEAD"], true);
    const branch = stdout.trim();
    return branch.length ? branch : null;
  }

  async readWorkingFile(relPath: string): Promise<string | null> {
    const absolute = path.join(this.cwd, relPath);
    try {
      const content = await fs.readFile(absolute, "utf8");
      return content;
    } catch {
      return null;
    }
  }

  async showStageFile(relPath: string, stage: 1 | 2 | 3): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["show", `:${stage}:${relPath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  async collectConflicts(remotes?: RemoteRefs): Promise<ConflictContext[]> {
    const paths = await this.listConflictPaths();
    const results: ConflictContext[] = [];
    for (const filePath of paths) {
      results.push(await this.describeConflict(filePath, remotes));
    }
    return results;
  }

  private async describeConflict(filePath: string, remotes?: RemoteRefs): Promise<ConflictContext> {
    const working = await this.readWorkingFile(filePath);
    const diff = await this.runGit(["diff", "--color=never", "--unified=40", "--", filePath], true);
    const base = await this.showStageFile(filePath, 1);
    const ours = await this.showStageFile(filePath, 2);
    const theirs = await this.showStageFile(filePath, 3);
    const originRefContent =
      remotes?.originRef && remotes.originRef.length
        ? await this.showRefFile(remotes.originRef, filePath)
        : null;
    const upstreamRefContent =
      remotes?.upstreamRef && remotes.upstreamRef.length
        ? await this.showRefFile(remotes.upstreamRef, filePath)
        : null;
    const originVsUpstreamDiff =
      remotes?.originRef && remotes?.upstreamRef
        ? await this.diffFileBetweenRefs(remotes.originRef, remotes.upstreamRef, filePath)
        : null;

    return {
      path: filePath,
      language: detectLanguage(filePath),
      lineCount: working ? countLines(working) : null,
      conflictMarkers: working ? countMarkers(working) : null,
      diffExcerpt: limitText(diff.stdout),
      workingExcerpt: limitText(working),
      baseExcerpt: limitText(base),
      oursExcerpt: limitText(ours),
      theirsExcerpt: limitText(theirs),
      originRefContent: limitText(originRefContent),
      upstreamRefContent: limitText(upstreamRefContent),
      originVsUpstreamDiff: limitText(originVsUpstreamDiff),
    };
  }

  private async showRefFile(ref: string, relPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["show", `${ref}:${relPath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  private async diffFileBetweenRefs(refA: string, refB: string, relPath: string): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(
        ["diff", "--color=never", `${refA}...${refB}`, "--", relPath],
        true,
      );
      return stdout.trim() ? stdout : null;
    } catch {
      return null;
    }
  }

  async compareRefs(originRef?: string | null, upstreamRef?: string | null): Promise<RemoteComparison | null> {
    if (!originRef || !upstreamRef) {
      return null;
    }
    try {
      const [diffAB, diffBA, logAB, logBA] = await Promise.all([
        this.runGit(["diff", "--stat", "--color=never", `${originRef}..${upstreamRef}`], true),
        this.runGit(["diff", "--stat", "--color=never", `${upstreamRef}..${originRef}`], true),
        this.runGit(["log", `${originRef}..${upstreamRef}`, "--oneline", "-n", "8"], true),
        this.runGit(["log", `${upstreamRef}..${originRef}`, "--oneline", "-n", "8"], true),
      ]);
      return {
        originRef,
        upstreamRef,
        commitsMissingFromOrigin: logAB.stdout.trim() || null,
        commitsMissingFromUpstream: logBA.stdout.trim() || null,
        diffstatOriginToUpstream: diffAB.stdout.trim() || null,
        diffstatUpstreamToOrigin: diffBA.stdout.trim() || null,
      };
    } catch {
      return null;
    }
  }
}

class MergeConflictSolver {
  private readonly codex: Codex;
  private readonly git: GitRepo;
  private coordinatorThread: Thread | null = null;
  private coordinatorPlan: string | null = null;

  constructor(private readonly options: SolverConfig) {
    this.codex = new Codex({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
    });
    this.git = new GitRepo(options.workingDirectory);
  }

  private get coordinatorThreadOptions(): ThreadOptions {
    return {
      model: this.options.coordinatorModel,
      sandboxMode: this.options.sandboxMode,
      approvalMode: this.options.approvalMode,
      workingDirectory: this.options.workingDirectory,
      skipGitRepoCheck: this.options.skipGitRepoCheck,
    };
  }

  private get workerThreadOptions(): ThreadOptions {
    return {
      ...this.coordinatorThreadOptions,
      model: this.options.workerModel,
    };
  }

  private get reviewerThreadOptions(): ThreadOptions {
    return {
      ...this.coordinatorThreadOptions,
      model: this.options.reviewerModel,
    };
  }

  async run(): Promise<void> {
    const conflicts = await this.git.collectConflicts({
      originRef: this.options.originRef,
      upstreamRef: this.options.upstreamRef,
    });
    if (conflicts.length === 0) {
      console.log("✅ No merge conflicts detected.");
      return;
    }

    console.log(`Detected ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}:`);
    for (const conflict of conflicts) {
      console.log(`  • ${conflict.path}`);
    }

    const remoteComparison = await this.git.compareRefs(this.options.originRef, this.options.upstreamRef);
    const snapshot = await this.buildSnapshot(conflicts, remoteComparison);
    await this.startCoordinator(snapshot);

    const outcomes: WorkerOutcome[] = [];
    for (const conflict of conflicts) {
      const outcome = await this.resolveConflict(conflict);
      outcomes.push(outcome);
      if (this.coordinatorThread) {
        const update = outcome.success
          ? `Conflict resolved for ${conflict.path}. Summary:\n${outcome.summary ?? "(no summary)"}`
          : `Conflict still open for ${conflict.path}. ${
              outcome.error ? `Error: ${outcome.error}` : "The file is still marked as conflicted."
            }`;
        await this.coordinatorThread.run(
          `Status update for ${conflict.path} from worker thread ${outcome.threadId ?? "n/a"}:\n${update}`,
        );
      }
    }

    const reviewSummary = await this.runReviewer(outcomes, remoteComparison);
    const remaining = await this.git.listConflictPaths();

    console.log("\n📋 Merge Summary");
    for (const outcome of outcomes) {
      const icon = outcome.success ? "✅" : "⚠️";
      console.log(`${icon} ${outcome.path}`);
      if (outcome.summary) {
        console.log(indent(outcome.summary.trim(), 4));
      }
      if (outcome.error) {
        console.log(indent(`Error: ${outcome.error}`, 4));
      }
    }

    if (reviewSummary) {
      console.log("\n🔍 Final reviewer notes:\n" + reviewSummary);
    }

    if (remaining.length > 0) {
      console.warn(
        `\n⚠️ Conflicts still present in ${remaining.length} file${remaining.length === 1 ? "" : "s"}:\n${remaining.join(
          "\n",
        )}`,
      );
      process.exitCode = 1;
    } else {
      console.log("\n🎉 All conflicts resolved according to git diff --name-only --diff-filter=U.");
    }
  }

  private async buildSnapshot(
    conflicts: ConflictContext[],
    remoteComparison: RemoteComparison | null,
  ): Promise<RepoSnapshot> {
    const [branch, statusShort, diffStat, recentCommits] = await Promise.all([
      this.git.getBranchName(),
      this.git.getStatusShort(),
      this.git.getDiffStat(),
      this.git.getRecentCommits(),
    ]);
    return {
      branch,
      statusShort,
      diffStat,
      recentCommits,
      conflicts,
      remoteComparison,
    };
  }

  private async startCoordinator(snapshot: RepoSnapshot): Promise<void> {
    this.coordinatorThread = this.codex.startThread(this.coordinatorThreadOptions);
    const coordinatorPrompt = buildCoordinatorPrompt(snapshot);
    console.log("\n🧠 Launching coordinator agent...");
    const turn = await this.coordinatorThread.run(coordinatorPrompt);
    this.coordinatorPlan = turn.finalResponse ?? null;
    if (this.coordinatorPlan) {
      console.log("\nCoordinator plan:\n" + this.coordinatorPlan);
    }
  }

  private async resolveConflict(conflict: ConflictContext): Promise<WorkerOutcome> {
    console.log(`\n🧩 Resolving ${conflict.path}...`);
    const workerThread = this.codex.startThread(this.workerThreadOptions);
    const prompt = buildWorkerPrompt(conflict, this.coordinatorPlan, {
      originRef: this.options.originRef,
      upstreamRef: this.options.upstreamRef,
    });
    try {
      const turn = await workerThread.run(prompt);
      const remaining = await this.git.listConflictPaths();
      const stillConflicted = remaining.includes(conflict.path);
      return {
        path: conflict.path,
        success: !stillConflicted,
        summary: turn.finalResponse ?? undefined,
        threadId: workerThread.id ?? undefined,
        error: stillConflicted ? "File remains conflicted after worker turn." : undefined,
      };
    } catch (error: any) {
      return {
        path: conflict.path,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        threadId: workerThread.id ?? undefined,
      };
    }
  }

  private async runReviewer(
    outcomes: WorkerOutcome[],
    remoteComparison: RemoteComparison | null,
  ): Promise<string | null> {
    console.log("\n🧾 Launching reviewer agent...");
    const reviewerThread = this.codex.startThread(this.reviewerThreadOptions);
    const remaining = await this.git.listConflictPaths();
    const status = await this.git.getStatusShort();
    const diffStat = await this.git.getDiffStat();
    const reviewerPrompt = buildReviewerPrompt({
      status,
      diffStat,
      remaining,
      workerSummaries: outcomes,
      remoteComparison,
    });
    const turn = await reviewerThread.run(reviewerPrompt);
    return turn.finalResponse ?? null;
  }
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".rs") return "Rust";
  if (ext === ".ts" || ext === ".tsx") return "TypeScript";
  if (ext === ".js" || ext === ".jsx") return "JavaScript";
  if (ext === ".md") return "Markdown";
  if (ext === ".json") return "JSON";
  if (ext === ".yml" || ext === ".yaml") return "YAML";
  if (ext === ".toml") return "TOML";
  if (ext === ".py") return "Python";
  if (ext === ".sh") return "Shell";
  return "Unknown";
}

function countLines(text: string): number {
  return text.split(/\r?\n/).length;
}

function countMarkers(text: string): number {
  const matches = text.match(/<{7,}|>{7,}|={7,}/g);
  return matches ? matches.length : 0;
}

function limitText(text: string | null, limit = MAX_CONTEXT_CHARS): string | null {
  if (!text) return null;
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n… truncated (${text.length - limit} additional chars)`;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function buildCoordinatorPrompt(snapshot: RepoSnapshot): string {
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
3. Highlight any cross-file coupling (e.g., sdk/typescript changes requiring sdk/native updates).
4. Provide sequencing guidance plus sanity checks (pnpm install/build/ci expectations).

Provide the plan as structured bullet points so downstream workers can pick up easily.`;
}

function buildWorkerPrompt(
  conflict: ConflictContext,
  coordinatorPlan: string | null,
  remotes?: RemoteRefs,
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

  return `# Merge Conflict Specialist – ${conflict.path}

You are the dedicated agent responsible for resolving the merge conflict in ${conflict.path} (${conflict.language}).

${HISTORICAL_PLAYBOOK}

Coordinator guidance:
${coordinatorPlan ?? "(coordinator has not provided additional notes)"}

Constraints:
- Operate ONLY on ${conflict.path} unless you must touch closely linked files (explain if so).
- Understand our branch vs upstream intent using git show :2:${conflict.path} / :3:${conflict.path} / :1:${conflict.path} before editing.
- Preserve intentional local increases (buffer sizes, limits, config tweaks).
- Mirror sdk/typescript → sdk/native implications if this file participates.
- After resolving the conflict, run rg '<<<<<<<' ${conflict.path} to ensure markers are gone, then git add ${conflict.path}.
- Summarize what you kept from each side plus any follow-up commands/tests to run.

Helpful context:
${combinedContext || "(no file excerpts available)"}

Deliverables:
1. Describe the conflicting intents you observed.
2. Explain the final merged solution and why it's safe.
3. List the commands you executed (shell/apply_patch/etc.).
4. Recommend validation steps (e.g., targeted tests) referencing pnpm build/ci expectations when relevant.`;
}

function buildReviewerPrompt(input: {
  status: string;
  diffStat: string;
  remaining: string[];
  workerSummaries: WorkerOutcome[];
  remoteComparison: RemoteComparison | null;
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
    ? `Remote divergence (${input.remoteComparison.originRef} ↔ ${input.remoteComparison.upstreamRef})
Commits only on ${input.remoteComparison.upstreamRef}:
${input.remoteComparison.commitsMissingFromOrigin ?? "<none>"}

Commits only on ${input.remoteComparison.originRef}:
${input.remoteComparison.commitsMissingFromUpstream ?? "<none>"}

Diff ${input.remoteComparison.originRef}..${input.remoteComparison.upstreamRef}:
${input.remoteComparison.diffstatOriginToUpstream ?? "<no diff>"}`
    : "Remote divergence context unavailable.";

  return `# Merge Conflict Reviewer

Goal: confirm that all conflicts are resolved, run/plan validation commands, and highlight any follow-ups.

Current git status:
${input.status || "<clean>"}

Diffstat:
${input.diffStat || "<none>"}

Remaining conflicted files (git diff --name-only --diff-filter=U):
${input.remaining.length ? input.remaining.join("\n") : "<none>"}

Worker notes:
${workerNotes}

${remoteSection}

Historical guardrails to honor:
${HISTORICAL_PLAYBOOK}

Tasks:
1. Double-check no conflict markers remain (consider 'rg "<<<<<<<"' across repo).
2. Ensure git status is staged/clean as appropriate.
3. If feasible, run pnpm install, pnpm build, and pnpm run ci. If they are too heavy, explain when/how they should run.
4. Summarize final merge state plus TODOs for the human operator.
5. Call out any files that still need manual attention.

Respond with a crisp summary plus checklist.`;
}

async function main(): Promise<void> {
  try {
    const solver = new MergeConflictSolver(CONFIG);
    await solver.run();
  } catch (error) {
    console.error("merge-conflict-solver failed:", error);
    process.exitCode = 1;
  }
}

void main();
 to 
