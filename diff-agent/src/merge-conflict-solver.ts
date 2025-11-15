#!/usr/bin/env node

/**
 * Merge Conflict Solver (diff-agent integration)
 *
 * Provides the multi-agent workflow previously shipped with the standalone script,
 * but refactored into reusable modules so diff-agent can expose it via --merge.
 */

import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { Codex, type Thread, type ThreadOptions } from "@codex-native/sdk";

import { runThreadTurnWithLogs } from "./threadLogging.js";
import {
  DEFAULT_COORDINATOR_MODEL,
  DEFAULT_WORKER_MODEL,
  DEFAULT_REVIEWER_MODEL,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_APPROVAL_MODE,
  CI_LOG_CONTEXT_LIMIT,
} from "./merge/constants.js";
import type {
  SolverConfig,
  RepoSnapshot,
  ConflictContext,
  RemoteComparison,
  RemoteRefs,
  WorkerOutcome,
} from "./merge/types.js";
import { GitRepo, indent } from "./merge/git.js";
import {
  buildCoordinatorPrompt,
  buildWorkerPrompt,
  buildReviewerPrompt,
  buildCiFailurePrompt,
  buildValidationPrompt,
  parseValidationSummary,
} from "./merge/prompts.js";
import {
  buildCiSnippetSection,
  extractCiFailures,
  matchCiFailureToOutcome,
} from "./merge/ci.js";
import { ApprovalSupervisor } from "./merge/supervisor.js";
import { createThreadLogger, logInfo, logWarn } from "./merge/logging.js";

const execFileAsync = promisify(execFile);

function getErrorCode(error: unknown): number | undefined {
  if (typeof error === "object" && error && "code" in error) {
    const possibleCode = (error as { code?: unknown }).code;
    return typeof possibleCode === "number" ? possibleCode : undefined;
  }
  return undefined;
}

export class MergeConflictSolver {
  private readonly codex: Codex;
  private readonly git: GitRepo;
  private readonly approvalSupervisor: ApprovalSupervisor | null;
  private coordinatorThread: Thread | null = null;
  private coordinatorPlan: string | null = null;
  private remoteComparison: RemoteComparison | null = null;
  private coordinatorUserMessageCount = 0;
  private readonly workerThreads = new Map<string, Thread>();
  private readonly ciThreads = new Map<string, Thread>();
  private conflicts: ConflictContext[] = [];

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

    this.conflicts = conflicts;
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
    this.syncCoordinatorBoard([]);

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
      this.syncCoordinatorBoard(outcomes);
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
    this.setWorkerPlan(workerThread, conflict.path);
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
      this.finalizeWorkerPlan(workerThread, conflict.path, !stillConflicted);
      return {
        path: conflict.path,
        success: !stillConflicted,
        summary: summaryText || undefined,
        threadId: workerThread.id ?? undefined,
        error: stillConflicted ? "File remains conflicted after worker turn." : undefined,
      };
    } catch (error: any) {
      this.approvalSupervisor?.setContext(null);
      this.finalizeWorkerPlan(workerThread, conflict.path, false);
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
    const snippetSection = buildCiSnippetSection(ciLog);
    const preparedLog =
      ciLog.length <= CI_LOG_CONTEXT_LIMIT
        ? snippetSection
          ? `${ciLog}\n\n${snippetSection}`
          : ciLog
        : await this.prepareOverflowCiLog(ciLog, snippetSection);
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

  private async prepareOverflowCiLog(ciLog: string, snippetSection: string | null): Promise<string> {
    logInfo("merge", `CI log is ${ciLog.length} chars (limit ${CI_LOG_CONTEXT_LIMIT}); summarizing overflow with codex-mini.`);
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

  private syncCoordinatorBoard(outcomes: WorkerOutcome[]): void {
    if (!this.coordinatorThread?.id || this.conflicts.length === 0) {
      return;
    }
    const completed = new Set<string>();
    const failed = new Set<string>();
    for (const outcome of outcomes) {
      if (outcome.success) {
        completed.add(outcome.path);
      } else if (outcome.error) {
        failed.add(outcome.path);
      }
    }
    const active = new Set<string>(Array.from(this.workerThreads.keys()));
    const plan = this.conflicts.map((conflict) => {
      let status: "pending" | "in_progress" | "completed" = "pending";
      if (completed.has(conflict.path)) {
        status = "completed";
      } else if (active.has(conflict.path) || failed.has(conflict.path)) {
        status = "in_progress";
      }
      return {
        step: `Resolve ${conflict.path}`,
        status,
      };
    });
    try {
      this.coordinatorThread.updatePlan({
        explanation: "Merge resolution task board",
        plan,
      });
    } catch {
      // plan updates are best-effort; ignore binding limitations
    }
  }

  private setWorkerPlan(thread: Thread, path: string): void {
    if (!thread.id) {
      return;
    }
    try {
      thread.updatePlan({
        explanation: `Plan for ${path}`,
        plan: [
          {
            step: "Compare base → ours → theirs diffs and write a triage summary",
            status: "in_progress",
          },
          {
            step: "Integrate both intents and describe kept/dropped changes",
            status: "pending",
          },
          {
            step: "Remove markers, stage file, list validation steps",
            status: "pending",
          },
        ],
      });
    } catch {
      // noop
    }
  }

  private finalizeWorkerPlan(thread: Thread, path: string, success: boolean): void {
    if (!thread.id) {
      return;
    }
    const status: "completed" | "in_progress" = success ? "completed" : "in_progress";
    try {
      thread.updatePlan({
        explanation: `Plan for ${path}`,
        plan: [
          {
            step: "Compare base → ours → theirs diffs and write a triage summary",
            status,
          },
          {
            step: "Integrate both intents and describe kept/dropped changes",
            status,
          },
          {
            step: "Remove markers, stage file, list validation steps",
            status,
          },
        ],
      });
    } catch {
      // noop
    }
  }
}

export function createDefaultSolverConfig(workingDirectory: string): SolverConfig {
  return {
    workingDirectory,
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
    originRef: process.env.CX_MERGE_ORIGIN_REF ?? "HEAD",
    upstreamRef: process.env.CX_MERGE_UPSTREAM_REF ?? "origin/main",
  };
}
