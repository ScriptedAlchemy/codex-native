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
  type ApprovalRequest,
} from "@codex-native/sdk";
import type { ThreadLoggingSink } from "./threadLogging";
import { runThreadTurnWithLogs } from "./threadLogging";

type LogScope =
  | "merge"
  | "git"
  | "coordinator"
  | "worker"
  | "supervisor"
  | "reviewer"
  | "validation";

const LOG_SCOPE_COLORS: Record<LogScope, string> = {
  merge: "\x1b[35m", // magenta
  git: "\x1b[34m", // blue
  coordinator: "\x1b[36m", // cyan
  worker: "\x1b[33m", // yellow
  supervisor: "\x1b[95m", // bright magenta
  reviewer: "\x1b[32m", // green
  validation: "\x1b[92m", // bright green
};

function formatScope(scope: LogScope, subject?: string): string {
  const color = LOG_SCOPE_COLORS[scope] ?? "";
  const reset = "\x1b[0m";
  const label = subject ? `${scope}:${subject}` : scope;
  return `${color}[merge-solver:${label}]${reset}`;
}

function logInfo(scope: LogScope, message: string, subject?: string): void {
  console.log(`${formatScope(scope, subject)} ${message}`);
}

function logWarn(scope: LogScope, message: string, subject?: string): void {
  console.warn(`${formatScope(scope, subject)} ${message}`);
}

function createThreadLogger(scope: LogScope, subject?: string): ThreadLoggingSink {
  return {
    info: (message) => logInfo(scope, message, subject),
    warn: (message) => logWarn(scope, message, subject),
  };
}

function getErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error && "code" in error) {
    const possibleCode = (error as { code?: unknown }).code;
    return typeof possibleCode === "number" ? possibleCode : undefined;
  }
  return undefined;
}

const execFileAsync = promisify(execFile);

const DEFAULT_COORDINATOR_MODEL = "gpt-5-codex";
const DEFAULT_WORKER_MODEL = "gpt-5-codex-mini";
const DEFAULT_REVIEWER_MODEL = "gpt-5-codex";
const DEFAULT_SANDBOX_MODE: SandboxMode = "workspace-write";
const DEFAULT_APPROVAL_MODE: ApprovalMode = "on-request";
const MAX_CONTEXT_CHARS = 5000;
const CI_LOG_CONTEXT_LIMIT = 15000;
const SUPERVISOR_OUTPUT_SCHEMA = {
  name: "merge_conflict_approval_decision",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["approve", "deny"] },
      reason: { type: "string", minLength: 4 },
      corrective_actions: {
        type: "array",
        items: { type: "string", minLength: 4 },
      },
    },
    required: ["decision", "reason"],
  },
};

const HISTORICAL_PLAYBOOK = `Session 019a8536-2265-7353-8669-7451ddaa2855 surfaced the following merge heuristics:
- Inspect each conflicting file to understand what our branch changed versus upstream before editing anything.
- Keep merges minimally invasive when replaying them; prefer integrating upstream intent instead of rewriting our local work.
- If sdk/typescript changes ripple through platform bindings, mirror the necessary adjustments in sdk/native during the same pass.
- Preserve intentional resource/size increases (buffers, limits, etc.) that we previously raised unless upstream explicitly supersedes them.
- Announce resolved files so parallel agents know which conflicts remain and what decisions were made.
- After conflicts are resolved, run pnpm install, pnpm build, and pnpm run ci (or at least outline how/when those checks will run).`;

const CI_SNIPPET_KEYWORDS = /\b(fail(?:ed)?|error|panic|pass(?:ed)?|ok)\b/i;
const CI_SNIPPET_CONTEXT_LINES = 2;
const CI_SNIPPET_MAX_SECTIONS = 5;

type SolverConfig = {
  workingDirectory: string;
  coordinatorModel: string;
  workerModel: string;
  reviewerModel: string;
  supervisorModel?: string;
  workerModelHigh?: string;
  workerModelLow?: string;
  highReasoningMatchers?: string[];
  lowReasoningMatchers?: string[];
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
  supervisorModel: "gpt-5-codex",
  workerModelHigh: DEFAULT_REVIEWER_MODEL,
  workerModelLow: DEFAULT_WORKER_MODEL,
  highReasoningMatchers: ["^codex-rs/core/", "^codex-rs/app-server/", "^codex-rs/common/"],
  lowReasoningMatchers: ["^\\.github/", "^docs/", "README\\.md$"],
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
  baseVsOursDiff?: string | null;
  baseVsTheirsDiff?: string | null;
  oursVsTheirsDiff?: string | null;
  recentHistory?: string | null;
  localIntentLog?: string | null;
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

type ApprovalContext = {
  conflictPath?: string;
  coordinatorPlan?: string | null;
  remoteInfo?: RemoteComparison | null;
  extraNotes?: string;
};

type SupervisorDecision = {
  decision: "approve" | "deny";
  reason: string;
  corrective_actions?: string[];
};

type SupervisorOptions = {
  model: string;
  workingDirectory: string;
  sandboxMode: SandboxMode;
};

type WorkerOutcome = {
  path: string;
  success: boolean;
  summary?: string;
  threadId?: string;
  error?: string;
  validationStatus?: "ok" | "fail";
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
    const baseVsOursDiff = await this.diffStageBlobs(filePath, 1, 2);
    const baseVsTheirsDiff = await this.diffStageBlobs(filePath, 1, 3);
    const oursVsTheirsDiff = await this.diffStageBlobs(filePath, 2, 3);
    const recentHistory = await this.getRecentHistory(filePath, 5);
    const localIntentLog = await this.getLocalIntentLog(remotes?.upstreamRef, filePath, 3);

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
      baseVsOursDiff: limitText(baseVsOursDiff),
      baseVsTheirsDiff: limitText(baseVsTheirsDiff),
      oursVsTheirsDiff: limitText(oursVsTheirsDiff),
      recentHistory: limitText(recentHistory, 2000),
      localIntentLog: limitText(localIntentLog, 2000),
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

  private async diffStageBlobs(filePath: string, left: 1 | 2 | 3, right: 1 | 2 | 3): Promise<string | null> {
    try {
      const leftSpec = `:${left}:${filePath}`;
      const rightSpec = `:${right}:${filePath}`;
      const { stdout } = await this.runGit(["diff", "--color=never", "--unified=40", leftSpec, rightSpec], true);
      return stdout.trim() ? stdout : null;
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

  private async getRecentHistory(relPath: string, limit: number): Promise<string | null> {
    try {
      const { stdout } = await this.runGit(["log", "-n", String(limit), "--oneline", "--", relPath], true);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async getLocalIntentLog(upstreamRef: string | null | undefined, relPath: string, limit: number): Promise<string | null> {
    if (!upstreamRef) {
      return null;
    }
    try {
      const { stdout } = await this.runGit(
        ["log", "--oneline", "-n", String(limit), `${upstreamRef}..HEAD`, "--", relPath],
        true,
      );
      return stdout.trim() || null;
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

  async isMergeInProgress(): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], { cwd: this.cwd });
      return true;
    } catch {
      return false;
    }
  }
}

class MergeConflictSolver {
  private readonly codex: Codex;
  private readonly git: GitRepo;
  private readonly approvalSupervisor: ApprovalSupervisor | null;
  private coordinatorThread: Thread | null = null;
  private coordinatorPlan: string | null = null;
  private remoteComparison: RemoteComparison | null = null;
  private coordinatorUserMessageCount = 0;
  private readonly workerThreads = new Map<string, Thread>();
  private readonly ciThreads = new Map<string, Thread>();
  private readonly ciThreads = new Map<string, Thread>();

  constructor(private readonly options: SolverConfig) {
    this.codex = new Codex({
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
    });
    this.git = new GitRepo(options.workingDirectory);
    this.approvalSupervisor = new ApprovalSupervisor(
      this.codex,
      {
        model: options.supervisorModel ?? options.coordinatorModel ?? DEFAULT_COORDINATOR_MODEL,
        workingDirectory: options.workingDirectory,
        sandboxMode: options.sandboxMode,
      },
      () => this.coordinatorThread,
    );
    if (this.approvalSupervisor.isAvailable()) {
      this.codex.setApprovalCallback(async (request) => this.approvalSupervisor!.handleApproval(request));
    } else {
      logWarn("supervisor", "Autonomous approval supervisor unavailable; falling back to default approval policy");
    }
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
    await this.ensureUpstreamMerge();
    logInfo("git", "Collecting merge conflicts via git diff --diff-filter=U");
    const conflicts = await this.git.collectConflicts({
      originRef: this.options.originRef,
      upstreamRef: this.options.upstreamRef,
    });
    if (conflicts.length === 0) {
      logInfo("merge", "No merge conflicts detected. Exiting early.");
      return;
    }

    logInfo("merge", `Detected ${conflicts.length} conflict${conflicts.length === 1 ? "" : "s"}`);
    for (const conflict of conflicts) {
      logInfo("worker", `Queued ${conflict.path}`, conflict.path);
    }

    logInfo(
      "git",
      `Comparing remotes ${this.options.originRef ?? "(none)"} and ${
        this.options.upstreamRef ?? "(none)"
      } for diverged commits`,
    );
    this.remoteComparison = await this.git.compareRefs(this.options.originRef, this.options.upstreamRef);
    const snapshot = await this.buildSnapshot(conflicts, this.remoteComparison);
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
        await runThreadTurnWithLogs(
          this.coordinatorThread,
          createThreadLogger("coordinator"),
          `Status update for ${conflict.path} from worker thread ${outcome.threadId ?? "n/a"}:\n${update}`,
        );
      }
    }

    const reviewSummary = await this.runReviewer(outcomes, this.remoteComparison);
    const remaining = await this.git.listConflictPaths();

    logInfo("merge", "Summarizing per-file outcomes");
    for (const outcome of outcomes) {
      const icon = outcome.success ? "✅" : "⚠️";
      logInfo("worker", `${icon} status`, outcome.path);
      if (outcome.summary) {
        logInfo("worker", indent(outcome.summary.trim(), 2), outcome.path);
      }
      if (outcome.error) {
      logWarn("worker", indent(`Error: ${outcome.error}`, 2), outcome.path);
      }
    }

    if (reviewSummary) {
      logInfo("reviewer", "Reviewer summary emitted");
      console.log(reviewSummary);
    }

    if (remaining.length > 0) {
      logWarn(
        "merge",
        `Conflicts still present in ${remaining.length} file${remaining.length === 1 ? "" : "s"}: ${remaining.join(
          ", ",
        )}`,
      );
      process.exitCode = 1;
    } else {
      logInfo("merge", "All conflicts resolved according to git diff --name-only --diff-filter=U");
      const validationOutcomes = await this.runValidationPhase(outcomes);
      if (validationOutcomes.length > 0) {
        await this.runReviewer(validationOutcomes, this.remoteComparison, true);
      }
      const ciResult = await this.runFullCi();
      if (ciResult.success) {
        logInfo("merge", "Verification stack complete (workers + pnpm run ci).");
      } else {
        await this.dispatchCiFailures(outcomes, ciResult.log);
      }
    }
  }

  private async ensureUpstreamMerge(): Promise<void> {
    const upstreamRef = this.options.upstreamRef;
    if (!upstreamRef) {
      logInfo("git", "No upstream ref configured; skipping auto-merge step");
      return;
    }
    if (await this.git.isMergeInProgress()) {
      logInfo("git", "Merge already in progress; skipping auto-merge initiation");
      return;
    }
    const delimiterIndex = upstreamRef.indexOf("/");
    if (delimiterIndex <= 0) {
      logWarn("git", "Unable to parse upstream ref; expected remote/branch", upstreamRef);
      return;
    }
    const remote = upstreamRef.slice(0, delimiterIndex);
    const branch = upstreamRef.slice(delimiterIndex + 1);
    if (!branch) {
      logWarn("git", "Upstream ref missing branch component", upstreamRef);
      return;
    }

    logInfo("git", `Fetching latest ${branch} from ${remote}`);
    await execFileAsync("git", ["fetch", remote, branch], { cwd: this.options.workingDirectory });

    logInfo("git", `Merging ${upstreamRef} into current branch with --no-commit --no-ff`);
    try {
      await execFileAsync("git", ["merge", "--no-commit", "--no-ff", upstreamRef], {
        cwd: this.options.workingDirectory,
      });
      logInfo("git", "Upstream merge completed without conflicts");
    } catch (error) {
      const exitCode = getErrorCode(error);
      if (exitCode === 1) {
        logInfo("git", "Merge introduced conflicts; invoking resolver workflow");
      } else {
        throw error;
      }
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
    logInfo("coordinator", "Launching coordinator agent for global merge plan");
    const turn = await runThreadTurnWithLogs(
      this.coordinatorThread,
      createThreadLogger("coordinator"),
      coordinatorPrompt,
    );
    this.coordinatorPlan = turn.finalResponse ?? null;
    this.coordinatorUserMessageCount += 1;
    if (this.coordinatorPlan) {
      logInfo("coordinator", "Coordinator issued plan:");
      console.log(this.coordinatorPlan);
    }
  }

  private async resolveConflict(conflict: ConflictContext): Promise<WorkerOutcome> {
    logInfo("worker", "Dispatching worker", conflict.path);
    const workerModel = this.selectWorkerModelForConflict(conflict);
    const workerThread = await this.acquireWorkerThread(conflict.path, workerModel);
    const prompt = buildWorkerPrompt(conflict, this.coordinatorPlan, {
      originRef: this.options.originRef,
      upstreamRef: this.options.upstreamRef,
    });
    this.approvalSupervisor?.setContext({
      conflictPath: conflict.path,
      coordinatorPlan: this.coordinatorPlan,
      remoteInfo: this.remoteComparison,
      extraNotes: "Worker is preparing to resolve this file.",
    });
    try {
      const turn = await runThreadTurnWithLogs(workerThread, createThreadLogger("worker", conflict.path), prompt);
      const remaining = await this.git.listConflictPaths();
      const stillConflicted = remaining.includes(conflict.path);
      const summaryText = turn.finalResponse ?? "";
      logInfo("worker", stillConflicted ? "Conflict persists" : "File resolved", conflict.path);
      this.approvalSupervisor?.setContext(null);
      return {
        path: conflict.path,
        success: !stillConflicted,
        summary: summaryText || undefined,
        threadId: workerThread.id ?? undefined,
        error: stillConflicted ? "File remains conflicted after worker turn." : undefined,
      };
    } catch (error: any) {
      this.approvalSupervisor?.setContext(null);
      logWarn("worker", `Worker failed: ${error}`, conflict.path);
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
    validationMode = false,
  ): Promise<string | null> {
    logInfo(validationMode ? "validation" : "reviewer", "Launching reviewer agent");
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
      validationMode,
    });
    const turn = await runThreadTurnWithLogs(
      reviewerThread,
      createThreadLogger(validationMode ? "validation" : "reviewer"),
      reviewerPrompt,
    );
    const summary = turn.finalResponse ?? null;
    if (summary) {
      logInfo(validationMode ? "validation" : "reviewer", "Reviewer produced summary");
    }
    return summary;
  }

  private async runValidationPhase(outcomes: WorkerOutcome[]): Promise<WorkerOutcome[]> {
    const validations: WorkerOutcome[] = [];
    for (const outcome of outcomes) {
      if (!outcome.success) {
        continue;
      }
      logInfo("validation", "Starting validation", outcome.path);
      const thread = this.codex.startThread(this.workerThreadOptions);
      const prompt = buildValidationPrompt(outcome.path, outcome.summary ?? "");
      const turn = await runThreadTurnWithLogs(thread, createThreadLogger("validation", outcome.path), prompt);
      const { status, summary } = parseValidationSummary(turn.finalResponse ?? "");
      validations.push({
        path: outcome.path,
        success: status === "ok",
        summary,
        threadId: thread.id ?? undefined,
        validationStatus: status,
      });
      logInfo(
        "validation",
        status === "ok" ? "Validation passed" : "Validation failed",
        outcome.path,
      );
    }
    return validations;
  }

  private async runFullCi(): Promise<{ success: boolean; log: string }> {
    logInfo("merge", "Running pnpm run ci for full verification suite");
    try {
      const { stdout, stderr } = await execFileAsync("pnpm", ["run", "ci"], {
        cwd: this.options.workingDirectory,
      });
      logInfo("merge", "pnpm run ci completed successfully");
      const combined = [stdout?.toString() ?? "", stderr?.toString() ?? ""]
        .filter((segment) => segment.length > 0)
        .join("\n");
      return { success: true, log: combined };
    } catch (error: any) {
      const stdout = error?.stdout ? error.stdout.toString() : "";
      const stderr = error?.stderr ? error.stderr.toString() : "";
      const combined = [stdout, stderr].filter((segment) => segment.length > 0).join("\n");
      logWarn("merge", `pnpm run ci failed${error?.code ? ` (exit ${error.code})` : ""}`);
      return { success: false, log: combined };
    }
  }

  private async dispatchCiFailures(outcomes: WorkerOutcome[], ciLog: string): Promise<void> {
    const preparedLog = await this.prepareCiLogForAgents(ciLog);
    const failures = extractCiFailures(ciLog);
    if (failures.length === 0) {
      for (const outcome of outcomes) {
        if (!outcome.success) {
          continue;
        }
        const thread = this.workerThreads.get(outcome.path);
        if (!thread) {
          logWarn("worker", "No worker thread available for CI follow-up", outcome.path);
          continue;
        }
        this.setCiPlan(thread, outcome.path, false);
        const prompt = buildCiFailurePrompt({
          targetLabel: outcome.path,
          workerSummary: outcome.summary ?? "",
          ciLog: preparedLog,
        });
        try {
          await runThreadTurnWithLogs(thread, createThreadLogger("worker", outcome.path), prompt);
        } catch (error) {
          logWarn("worker", `Failed to push CI failure context: ${error}`, outcome.path);
        }
      }
      return;
    }

    for (const failure of failures) {
      const matchedOutcome = matchCiFailureToOutcome(failure, outcomes);
      if (matchedOutcome) {
        const thread = this.workerThreads.get(matchedOutcome.path);
        if (!thread) {
          logWarn("worker", "Matched CI failure to worker but thread missing", matchedOutcome.path);
          continue;
        }
        this.setCiPlan(thread, failure.label, false);
        const prompt = buildCiFailurePrompt({
          targetLabel: matchedOutcome.path,
          workerSummary: matchedOutcome.summary ?? "",
          ciLog: preparedLog,
          snippet: failure.snippet,
          failureLabel: failure.label,
          pathHints: failure.pathHints,
        });
        try {
          await runThreadTurnWithLogs(thread, createThreadLogger("worker", matchedOutcome.path), prompt);
        } catch (error) {
          logWarn("worker", `Failed to push CI failure context: ${error}`, matchedOutcome.path);
        }
        continue;
      }

      const ciThread = await this.acquireCiThread(failure.label);
      this.setCiPlan(ciThread, failure.label, true);
      const prompt = buildCiFailurePrompt({
        targetLabel: failure.label,
        workerSummary: "",
        ciLog: preparedLog,
        snippet: failure.snippet,
        failureLabel: failure.label,
        pathHints: failure.pathHints,
        isNewAgent: true,
      });
      try {
        await runThreadTurnWithLogs(ciThread, createThreadLogger("worker", failure.label), prompt);
        this.setCiPlan(ciThread, failure.label, true);
      } catch (error) {
        logWarn("worker", `CI specialist thread failed: ${error}`, failure.label);
      }
    }
  }

  private async prepareCiLogForAgents(ciLog: string): Promise<string> {
    const snippetSection = buildCiSnippetSection(ciLog);
    if (ciLog.length <= CI_LOG_CONTEXT_LIMIT) {
      return snippetSection ? `${ciLog}\n\n${snippetSection}` : ciLog;
    }
    logInfo(
      "merge",
      `CI log is ${ciLog.length} chars (limit ${CI_LOG_CONTEXT_LIMIT}); summarizing overflow with codex-mini.`,
    );
    const prefix = ciLog.slice(0, CI_LOG_CONTEXT_LIMIT);
    const overflow = ciLog.slice(CI_LOG_CONTEXT_LIMIT);
    const summary = await this.summarizeCiOverflow(overflow);
    const summarySection = summary
      ? `\n\n[Overflow summary via codex-mini; ${overflow.length} chars condensed]\n${summary}`
      : "\n\n[Overflow summary unavailable due to summarizer error]";
    const withSummary = `${prefix}${summarySection}`;
    return snippetSection ? `${withSummary}\n\n${snippetSection}` : withSummary;
  }

  private async summarizeCiOverflow(overflow: string): Promise<string | null> {
    try {
      const summaryThread = this.codex.startThread({
        ...this.workerThreadOptions,
        model: this.options.workerModelLow ?? DEFAULT_WORKER_MODEL,
      });
      const prompt = `Summarize the following CI log overflow (length ${overflow.length} chars) into concise bullets highlighting failing crates/tests and key errors. Limit to 300 words.\n\nOverflow log:\n${overflow}`;
      const turn = await runThreadTurnWithLogs(summaryThread, createThreadLogger("worker", "ci-overflow"), prompt);
      return turn.finalResponse?.trim() || null;
    } catch (error) {
      logWarn("merge", `Failed to summarize CI overflow: ${error}`);
      return null;
    }
  }

  private setCiPlan(thread: Thread, failureLabel: string, isNewAgent: boolean): void {
    if (!thread.id) {
      return;
    }
    try {
      thread.updatePlan({
        explanation: `CI remediation plan for ${failureLabel}`,
        plan: [
          {
            step: `Diagnose failing test/module ${failureLabel}`,
            status: "in_progress",
          },
          {
            step: "Draft fix and explain changes",
            status: "pending",
          },
          {
            step: "Run targeted tests or pnpm run ci",
            status: "pending",
          },
        ],
      });
      logInfo("worker", isNewAgent ? "Initialized CI plan" : "Updated CI plan", failureLabel);
    } catch (error) {
      logWarn("worker", `Unable to update CI plan: ${error}`, failureLabel);
    }
  }

  private selectWorkerModel(filePath: string): string {
    const matches = (patterns?: string[]) =>
      patterns?.some((pattern) => {
        try {
          return new RegExp(pattern).test(filePath);
        } catch {
          return false;
        }
      }) ?? false;

    if (matches(this.options.highReasoningMatchers) && this.options.workerModelHigh) {
      return this.options.workerModelHigh;
    }
    if (matches(this.options.lowReasoningMatchers) && this.options.workerModelLow) {
      return this.options.workerModelLow;
    }
    return this.options.workerModel;
  }

  private selectWorkerModelForConflict(conflict: ConflictContext): string {
    const severityScore =
      (conflict.lineCount ?? 0) + (conflict.conflictMarkers ?? 0) * 200;
    if (severityScore >= 800 && this.options.workerModelHigh) {
      return this.options.workerModelHigh;
    }
    return this.selectWorkerModel(conflict.path);
  }

  private async acquireWorkerThread(filePath: string, modelOverride?: string): Promise<Thread> {
    const existing = this.workerThreads.get(filePath);
    if (existing) {
      return existing;
    }
    const model = modelOverride ?? this.selectWorkerModel(filePath);
    const threadOptions: ThreadOptions = {
      ...this.workerThreadOptions,
      model,
    };
    if (this.coordinatorThread) {
      try {
        const forked = await this.coordinatorThread.fork({
          nthUserMessage: this.coordinatorUserMessageCount,
          threadOptions,
        });
        this.workerThreads.set(filePath, forked);
        return forked;
      } catch (error) {
        logWarn("worker", `Unable to fork coordinator for ${filePath}; starting standalone thread`, filePath);
      }
    }
    const thread = this.codex.startThread(threadOptions);
    this.workerThreads.set(filePath, thread);
    return thread;
  }

  private async acquireCiThread(label: string): Promise<Thread> {
    const existing = this.ciThreads.get(label);
    if (existing) {
      return existing;
    }
    const threadOptions: ThreadOptions = {
      ...this.workerThreadOptions,
      model: this.options.workerModelHigh ?? this.options.reviewerModel ?? this.options.workerModel,
    };
    let thread: Thread;
    if (this.coordinatorThread) {
      try {
        thread = await this.coordinatorThread.fork({
          nthUserMessage: this.coordinatorUserMessageCount,
          threadOptions,
        });
        this.ciThreads.set(label, thread);
        return thread;
      } catch (error) {
        logWarn("worker", `Unable to fork coordinator for CI thread "${label}"; starting standalone`, label);
      }
    }
    thread = this.codex.startThread(threadOptions);
    this.ciThreads.set(label, thread);
    return thread;
  }
}

class ApprovalSupervisor {
  private readonly thread: Thread | null;
  private context: ApprovalContext | null = null;

  constructor(
    private readonly codex: Codex,
    private readonly options: SupervisorOptions,
    private readonly coordinatorThreadAccessor: () => Thread | null,
  ) {
    try {
      this.thread = this.codex.startThread({
        model: options.model,
        sandboxMode: options.sandboxMode,
        approvalMode: "never",
        workingDirectory: options.workingDirectory,
        skipGitRepoCheck: true,
      });
    } catch (error) {
      logWarn("supervisor", `Unable to start approval supervisor thread: ${error}`);
      this.thread = null;
    }
  }

  isAvailable(): boolean {
    return Boolean(this.thread);
  }

  setContext(context: ApprovalContext | null): void {
    this.context = context;
    if (context?.conflictPath) {
      logInfo("supervisor", "Monitoring worker", context.conflictPath);
    }
  }

  async handleApproval(request: ApprovalRequest): Promise<boolean> {
    if (!this.thread) {
      logWarn("supervisor", "Supervisor unavailable; auto-denying", request.type);
      return false;
    }
    const contextSummary = this.context
      ? `Conflict: ${this.context.conflictPath ?? "<unknown>"}\nPlan: ${
          this.context.coordinatorPlan?.slice(0, 2000) ?? "<none>"
        }\nRemote divergence: ${
          this.context.remoteInfo
            ? `${this.context.remoteInfo.originRef} ↔ ${this.context.remoteInfo.upstreamRef}`
            : "<not available>"
        }\nNotes: ${this.context.extraNotes ?? "<none>"}`
      : "No active worker context.";
    const detailsBlock =
      request.details !== undefined ? JSON.stringify(request.details, null, 2) : "<no additional details>";

    const prompt = `# Autonomous Approval Supervisor

You are a high-reasoning control agent responsible for approving or denying sensitive operations during a merge conflict remediation workflow. Only approve commands that are safe, necessary, and aligned with the plan. If a request is risky or redundant, deny it and explain the corrective guidance you want the worker to follow.

Context:
${contextSummary}

Approval request:
- Type: ${request.type}
- Details: ${detailsBlock}

Respond on the first line with either "APPROVE: <short reason>" or "DENY: <short reason>". You may follow up with bullet points containing corrective actions if denying.`;

    try {
      const turn = await runThreadTurnWithLogs(
        this.thread,
        createThreadLogger("supervisor", this.context?.conflictPath),
        prompt,
        { outputSchema: SUPERVISOR_OUTPUT_SCHEMA },
      );
      const parsedDecision = parseSupervisorDecision(turn.finalResponse);
      if (!parsedDecision) {
        logWarn("supervisor", "Produced non-JSON response; denying request", request.type);
        return false;
      }
      const approved = parsedDecision.decision === "approve";
      const summary =
        `${parsedDecision.decision.toUpperCase()}: ${parsedDecision.reason}` +
        (parsedDecision.corrective_actions?.length
          ? ` | Actions: ${parsedDecision.corrective_actions.join("; ")}`
          : "");
      if (!approved) {
        const coordinator = this.coordinatorThreadAccessor();
        if (coordinator) {
          const note =
            `Supervisor denied ${request.type}.\nReason: ${parsedDecision.reason}\n` +
            `Actions: ${parsedDecision.corrective_actions?.join("; ") ?? "(none)"}\nContext: ${contextSummary}`;
          await runThreadTurnWithLogs(coordinator, createThreadLogger("coordinator"), note);
        }
      }
      logInfo("supervisor", summary, request.type);
      return approved;
    } catch (error) {
      logWarn("supervisor", `Failed to respond; denying ${request.type}. ${error}`, request.type);
      return false;
    }
  }
}

function parseSupervisorDecision(response: string): SupervisorDecision | null {
  if (!response) {
    return null;
  }
  try {
    const parsed = JSON.parse(response) as SupervisorDecision | { output?: SupervisorDecision };
    if (isDecision(parsed)) {
      return parsed;
    }
    if (parsed && typeof (parsed as any).output === "object" && isDecision((parsed as any).output)) {
      return (parsed as any).output;
    }
    return null;
  } catch {
    return null;
  }
}

function isDecision(value: unknown): value is SupervisorDecision {
  if (!value || typeof value !== "object") return false;
  const decision = (value as SupervisorDecision).decision;
  const reason = (value as SupervisorDecision).reason;
  return (
    (decision === "approve" || decision === "deny") &&
    typeof reason === "string" &&
    reason.trim().length > 0
  );
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
    analysisSections,
    conflict.localIntentLog
      ? `### Local intent commits (not in upstream)\n${conflict.localIntentLog}`
      : null,
    conflict.recentHistory ? `### Recent git log (last 5 commits)\n${conflict.recentHistory}` : null,
  ]
    .filter((chunk) => chunk && chunk.length)
    .join("\n\n") || "(no supplemental analysis available)";

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
- Your shell/file-write accesses are gated by an autonomous supervisor; justify sensitive steps so approvals go through.
- Begin with a short research note referencing the diffs/logs below before modifying any code.
- Do not run tests/builds/formatters during this resolution phase; a dedicated validation turn will follow.
- Use the "Local intent" commit snippets below to understand why our branch diverged before editing.

Helpful context:
${combinedContext || "(no file excerpts available)"}

## Research materials
${researchResources}

Deliverables:
1. Describe the conflicting intents you observed.
2. Explain the final merged solution and why it's safe.
3. Provide the research summary (key insights from diffs/logs) before detailing edits.
4. List the commands you executed (shell/apply_patch/etc.).
5. Recommend validation steps (e.g., targeted tests) referencing pnpm build/ci expectations when relevant.`;
}

function buildReviewerPrompt(input: {
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
      }..${input.remoteComparison.upstreamRef}:\n${input.remoteComparison.diffstatOriginToUpstream ?? "<no diff>"}`
    : "Remote divergence context unavailable.";

  const remainingBlock = input.remaining.length ? input.remaining.join("\n") : "<none>";

  return `# Merge Conflict Reviewer\n\nGoal: confirm that all conflicts are resolved, run/plan validation commands, and highlight any follow-ups.\n\nCurrent git status:\n${
    input.status || "<clean>"
  }\n\nDiffstat:\n${input.diffStat || "<none>"}\n\nRemaining conflicted files (git diff --name-only --diff-filter=U):\n${remainingBlock}\n\nWorker notes:\n${workerNotes}\n\n${remoteSection}\n\nHistorical guardrails to honor:\n${HISTORICAL_PLAYBOOK}\n\nTasks:\n1. ${
    input.validationMode
      ? "Run targeted tests for each resolved file (unit/integration only)."
      : 'Double-check no conflict markers remain (consider "rg <<<<<<" across repo).'
  }\n2. ${
    input.validationMode ? "Report pass/fail per file and note any new issues." : "Ensure git status is staged/clean as appropriate."
  }\n3. ${
    input.validationMode
      ? "List broader suites (pnpm build/ci) to run once targeted checks pass."
      : "If feasible, run pnpm install, pnpm build, and pnpm run ci. If they are too heavy, explain when/how they should run."
  }\n4. Summarize final merge state plus TODOs for the human operator.\n5. Call out any files that still need manual attention.\n\nRespond with a crisp summary plus checklist.`;
}

type CiFailurePromptInput = {
  targetLabel: string;
  workerSummary?: string;
  ciLog: string;
  snippet?: string;
  failureLabel?: string;
  pathHints?: string[];
  isNewAgent?: boolean;
};

function buildCiFailurePrompt(input: CiFailurePromptInput): string {
  const {
    targetLabel,
    workerSummary,
    ciLog,
    snippet,
    failureLabel,
    pathHints,
    isNewAgent,
  } = input;
  const introTarget = failureLabel && failureLabel !== targetLabel ? `${targetLabel} (${failureLabel})` : targetLabel;
  const ownershipNote = isNewAgent
    ? "You are a CI specialist picking up this failure for the first time."
    : "Continue from your previous merge context for this path.";
  const hintsBlock = pathHints?.length
    ? `Path/test hints: ${pathHints.join(", ")}`
    : "Path/test hints: (not detected)";
  const snippetBlock = snippet ? `\n\nFocused snippet:\n${snippet}` : "";
  return `# pnpm run ci regression follow-up – ${introTarget}

${ownershipNote}

Previous merge summary:
${workerSummary && workerSummary.trim().length ? workerSummary : "(no summary provided)"}

${hintsBlock}${snippetBlock}

Full pnpm run ci digest (prefix + summaries):
${ciLog || "(no log output captured)"}

Tasks:
1. Use the snippet and hints to determine the failing test/module.
2. Explain why the failure occurs and propose concrete fixes (code/config/tests).
3. Outline the exact commands/tests you will run after applying the fix (rerun pnpm run ci or targeted tests as needed).
4. If this failure belongs to another subsystem, document that clearly and reassign with justification.

Respond with a structured summary plus next steps so the orchestrator can decide how to re-run CI.`;
}

type CiSnippet = {
  text: string;
  startLine: number;
  endLine: number;
};

function collectCiSnippets(log: string): CiSnippet[] {
  const lines = log.split(/\r?\n/);
  const snippets: CiSnippet[] = [];
  for (let i = 0; i < lines.length && snippets.length < CI_SNIPPET_MAX_SECTIONS; i += 1) {
    const line = lines[i];
    if (!line || !CI_SNIPPET_KEYWORDS.test(line)) {
      continue;
    }
    const start = Math.max(0, i - CI_SNIPPET_CONTEXT_LINES);
    const end = Math.min(lines.length, i + CI_SNIPPET_CONTEXT_LINES + 1);
    const snippetLines = lines.slice(start, end);
    snippets.push({
      text: snippetLines.join("\n"),
      startLine: start + 1,
      endLine: end,
    });
    i = end - 1;
  }
  return snippets;
}

function buildCiSnippetSection(log: string): string | null {
  const snippets = collectCiSnippets(log);
  if (snippets.length === 0) {
    return null;
  }
  const section = snippets
    .map(
      (snippet, idx) =>
        `Snippet ${idx + 1} (lines ${snippet.startLine}-${snippet.endLine}):\n${snippet.text}`,
    )
    .join("\n\n");
  return `[Keyword snippets]\n${section}`;
}

type CiFailure = {
  label: string;
  snippet: string;
  pathHints: string[];
};

function extractCiFailures(log: string): CiFailure[] {
  const snippets = collectCiSnippets(log);
  return snippets.map((snippet, idx) => {
    const pathHints = derivePathHints(snippet.text);
    const snippetLead = snippet.text
      .split(/\r?\n/)[0]
      .trim()
      .slice(0, 80);
    const label = (pathHints[0] ?? snippetLead) || `ci-failure-${idx + 1}`;
    return {
      label,
      snippet: snippet.text,
      pathHints,
    };
  });
}

function derivePathHints(text: string): string[] {
  const hints = new Set<string>();
  const pathRegex = /([A-Za-z0-9_./-]+\.(?:rs|ts|tsx|js|jsx|py|sh|toml|json|yml|yaml|md))/g;
  for (const match of text.matchAll(pathRegex)) {
    hints.add(match[1]);
  }
  const crateRegex = /----\s+([A-Za-z0-9_:-]+)\s*----/g;
  for (const match of text.matchAll(crateRegex)) {
    hints.add(match[1]);
  }
  return Array.from(hints);
}

function matchCiFailureToOutcome(failure: CiFailure, outcomes: WorkerOutcome[]): WorkerOutcome | null {
  if (!failure.pathHints.length) {
    return null;
  }
  for (const outcome of outcomes) {
    if (!outcome.path) {
      continue;
    }
    if (failure.pathHints.some((hint) => outcome.path.includes(hint) || hint.includes(outcome.path))) {
      return outcome;
    }
  }
  return null;
}

function buildValidationPrompt(path: string, workerSummary: string): string {
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

function parseValidationSummary(text: string): { status: "ok" | "fail"; summary: string } {
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
