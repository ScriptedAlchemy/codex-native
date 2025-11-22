#!/usr/bin/env node

/**
 * Merge Conflict Solver (agents suite integration)
 *
 * Provides the multi-agent workflow previously shipped with the standalone script,
 * but refactored into reusable modules so the suite can expose it via --merge.
 */

import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { Codex, type Thread, type ThreadOptions, type Usage } from "@codex-native/sdk";

import { runThreadTurnWithLogs } from "./thread-logging.js";
import {
  DEFAULT_COORDINATOR_MODEL,
  DEFAULT_WORKER_MODEL,
  DEFAULT_REVIEWER_MODEL,
  DEFAULT_SANDBOX_MODE,
  DEFAULT_APPROVAL_MODE,
  CI_LOG_CONTEXT_TOKENS,
  CI_OVERFLOW_SUMMARY_MAX_TOKENS,
  MERGE_REVIEW_OUTPUT_SCHEMA,
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
  buildValidationPrompt,
  parseValidationSummary,
  buildPerFileReviewPrompt,
  buildVerificationPrompt,
  buildStagingPrompt,
  buildOursAnalysisPrompt,
  buildTheirsAnalysisPrompt,
  buildIntentAnalysisPrompt,
  buildIntegrationPrompt,
  buildQuickVerificationPrompt,
  buildQuickStagingPrompt,
} from "./merge/prompts.js";
import { OpenCodeAgent, tokenizerCount } from "@codex-native/sdk";
import { countMarkers } from "./merge/git.js";
import { buildCiFailurePrompt } from "./ci/prompts.js";
import {
  buildCiSnippetSection,
  clampOverflowForSummary,
  extractCiFailures,
  matchCiFailureToOutcome,
} from "./merge/ci.js";
import { ApprovalSupervisor } from "./merge/supervisor.js";
import { createThreadLogger, logInfo, logWarn, type LogScope } from "./merge/logging.js";
import { ThreadManager } from "./shared/threadManager.js";
import { collectRepoSnapshot } from "./shared/snapshot.js";
import { TokenTracker } from "./shared/tokenTracker.js";

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
  private readonly threads: ThreadManager;
  private readonly tokenTracker = new TokenTracker();
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
      apiKey: options.apiKey,  // Will be undefined from createDefaultSolverConfig
      modelProvider: "openai",
    });
    this.git = new GitRepo(options.workingDirectory);
    this.threads = new ThreadManager(this.codex, options.workingDirectory);
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
      reasoningEffort: this.options.reasoningEffort,
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

  private conflictIsSimple(conflict: ConflictContext): boolean {
    const markers = conflict.conflictMarkers ?? Number.MAX_SAFE_INTEGER;
    const lines = conflict.lineCount ?? Number.MAX_SAFE_INTEGER;
    const diffLen = conflict.diffExcerpt?.length ?? 0;
    return markers <= 6 && lines <= 400 && diffLen <= 4_000;
  }

  private async resolveConflictWithDualAgent(
    conflict: ConflictContext,
    attempt = 1,
  ): Promise<WorkerOutcome> {
    logInfo("worker", "Using dual-agent approach (GPT-5 supervisor + OpenCode/Sonnet worker)", conflict.path);

    const beforeContent = await this.git.readWorkingFile(conflict.path);

    // Step 1: GPT-5 Supervisor creates analysis plan using smart model
    logInfo("worker", "GPT-5 supervisor analyzing conflict strategy", conflict.path);
    logInfo("worker", `Conflict size: ${conflict.workingExcerpt?.length || 0} chars`, conflict.path);

    const supervisorThread = this.threads.start({
      ...this.workerThreadOptions,
      model: this.options.supervisorModel ?? "gpt-5.1-codex",
      reasoningEffort: "high",  // High reasoning for complex merge analysis - supervisor is the strategic brain
    });

    const analysisPrompt = `CONFLICT: ${conflict.path}

BASE → OURS (what we changed):
${conflict.baseVsOursDiff || "N/A"}

BASE → THEIRS (what upstream changed):
${conflict.baseVsTheirsDiff || "N/A"}

CONFLICT MARKERS (current file with <<<< ==== >>>>):
${conflict.workingExcerpt || "N/A"}

OUTPUT (3 parts only):
1. Intent: [what each side wants]
2. Keep: [specific lines/blocks from each]
3. Steps: [(1) action (2) action...]`;

    const supervisorTurn = await runThreadTurnWithLogs(
      supervisorThread,
      this.logger("worker", `${conflict.path}:gpt5-supervisor`),
      analysisPrompt
    );

    const strategy = supervisorTurn.finalResponse ?? "(no strategy provided)";
    logInfo("worker", "GPT-5 supervisor provided strategy, launching OpenCode/Sonnet worker", conflict.path);

    // Step 2: OpenCode agent with Claude Sonnet 4.5 executes the plan
    const opencodeAgent = new OpenCodeAgent({
      model: "anthropic/claude-sonnet-4-5-20250929",
      workingDirectory: this.options.workingDirectory,
      onApprovalRequest: async (request) => {
        logInfo("worker", `OpenCode requested approval: ${request.type} - ${request.title}`, conflict.path);

        // Send approval request back to GPT-5 supervisor for decision using structured output
        const approvalPrompt = `OpenCode requests: ${request.type} - ${request.title}
File: ${conflict.path}
${request.metadata ? `Details: ${JSON.stringify(request.metadata).slice(0, 100)}` : ''}

Decide: approve/reject AND scope (once/always)
- Use "always" for safe, repeatable operations (git add, grep, read)
- Use "once" for file modifications or risky operations`;

        const approvalSchema = {
          type: "object" as const,
          additionalProperties: false,
          properties: {
            approved: { type: "boolean" as const },
            scope: {
              type: "string" as const,
              enum: ["once" as const, "always" as const],
              description: "once for single approval, always for all similar requests"
            },
            reason: { type: "string" as const, maxLength: 100 }
          },
          required: ["approved" as const, "scope" as const]
        };

        const approvalTurn = await runThreadTurnWithLogs(
          supervisorThread,
          this.logger("worker", conflict.path),
          approvalPrompt,
          { outputSchema: approvalSchema }
        );

        let decision: any;
        try {
          decision = JSON.parse(approvalTurn.finalResponse ?? "{}");
        } catch (e) {
          logWarn("worker", "Failed to parse approval decision, rejecting", conflict.path);
          return "reject";
        }

        const approved = decision.approved === true;
        const scope = decision.scope || "once";
        const reason = decision.reason || "No reason provided";

        logInfo("worker", `GPT-5 supervisor ${approved ? `APPROVED (${scope})` : "REJECTED"}: ${reason}`, conflict.path);

        // If approved and it's git add, also stage directly
        if (approved && request.type === "shell" && request.title?.includes("git add")) {
          await this.git.stageFile(conflict.path);
          logInfo("worker", "Staged file after GPT-5 approval", conflict.path);
        }

        // Return explicit permission decision with scope from supervisor
        return approved ? scope : "reject";
      },
    });

    const executionPrompt = `# Execute Merge Resolution for ${conflict.path}

You are resolving a merge conflict. Follow these instructions from the GPT-5 supervisor exactly:

## Supervisor's Strategy
${strategy}

## Current conflicted file location
The file is at: ${conflict.path}

## Your specific tasks:
1. Read the current conflicted file: ${conflict.path}
2. Apply the edits according to the supervisor's strategy above
3. Remove ALL conflict markers (<<<<<<, ======, >>>>>>)
4. Write the resolved file back to ${conflict.path}
5. Verify no conflict markers remain by running: rg '<<<<<<<' ${conflict.path}
6. Stage the resolved file by running: git add ${conflict.path}

Execute these tasks now. Focus on following the supervisor's instructions exactly.
Do not re-analyze - just execute the plan provided.`;

    const result = await opencodeAgent.delegate(executionPrompt);

    logInfo("worker", `OpenCode/Sonnet completed: ${result.success ? "success" : "failed"}`, conflict.path);

    if (!result.success) {
      logWarn("worker", `OpenCode execution failed: ${result.error}`, conflict.path);
    }

    // Step 3: GPT-5 ALWAYS reviews the work (not just on failure)
    const [afterContent, remaining] = await Promise.all([
      this.git.readWorkingFile(conflict.path),
      this.git.listConflictPaths(),
    ]);

    const changed = beforeContent !== afterContent;
    const markerCount = afterContent ? countMarkers(afterContent) : 0;
    let stillConflicted = markerCount > 0 || remaining.includes(conflict.path);

    // Step 3: GPT-5 supervisor reviews (SKIP if obviously successful)
    // Quick check if resolution is obviously good
    const [checkContent, checkConflicts] = await Promise.all([
      this.git.readWorkingFile(conflict.path),
      this.git.listConflictPaths(),
    ]);

    const hasMarkers = checkContent ? countMarkers(checkContent) > 0 : false;
    stillConflicted = checkConflicts.includes(conflict.path);

    // Skip review if obviously resolved
    if (!hasMarkers && !stillConflicted) {
      logInfo("worker", "Resolution obviously successful, skipping review", conflict.path);
      // Stage the resolved file
      await this.git.stageFile(conflict.path);
      logInfo("worker", "Staged resolved file", conflict.path);
      return {
        path: conflict.path,
        success: true,
        changed: true,
        summary: strategy || "Resolved via dual-agent pattern",
        threadId: result.sessionId,
      };
    }

    // Step 4: Skip review if obviously resolved, otherwise quick review
    if (!stillConflicted && changed) {
      // File is clearly resolved - skip the review to save time
      logInfo("worker", "File resolved successfully, skipping review", conflict.path);
      await this.git.stageFile(conflict.path);
      return {
        path: conflict.path,
        success: true,
        changed: true,
        summary: "Auto-approved: No conflicts detected, file changed as expected",
        threadId: result.sessionId,
      };
    }

    logInfo("worker", "GPT-5 supervisor reviewing OpenCode's work", conflict.path);

    const reviewPrompt = `REVIEW (minimize reasoning):
File: ${conflict.path}
Markers: ${markerCount} | Changed: ${changed} | Status: ${stillConflicted ? "CONFLICTED" : "RESOLVED"}

${stillConflicted ? `CRITICAL - Still has conflicts! First marker:
${afterContent ? afterContent.slice(afterContent.indexOf('<<<<'), Math.min(afterContent.indexOf('<<<<') + 200, afterContent.length)) : "N/A"}

Provide EXACT fix or reject.` : `OpenCode output (100 chars): ${result.output ? result.output.slice(0, 100) : "N/A"}`}`;

    // Use structured output for the review decision
    const reviewTurn = await runThreadTurnWithLogs(
      supervisorThread,
      this.logger("worker", `${conflict.path}:gpt5-supervisor`),
      reviewPrompt,
      { outputSchema: MERGE_REVIEW_OUTPUT_SCHEMA }
    );

    // Parse the structured response
    let reviewDecision: any;
    try {
      reviewDecision = JSON.parse(reviewTurn.finalResponse ?? "{}");
    } catch (e) {
      logWarn("worker", "Failed to parse GPT-5 review as JSON, treating as rejection", conflict.path);
      return {
        path: conflict.path,
        success: false,
        changed,
        summary: `[GPT-5 + OpenCode/Sonnet - PARSE ERROR]\n\nResponse: ${reviewTurn.finalResponse}`,
        error: "Failed to parse supervisor review",
      };
    }

    const decision = reviewDecision.decision?.toLowerCase();
    logInfo("worker", `GPT-5 decision: ${decision} - ${reviewDecision.reason}`, conflict.path);

    // Handle the structured decision
    if (decision === "approved") {
      logInfo("worker", "GPT-5 supervisor APPROVED the resolution", conflict.path);

      // Stage the approved file directly
      if (!stillConflicted) {
        await this.git.stageFile(conflict.path);
        logInfo("worker", "Staged approved file", conflict.path);
      }

      return {
        path: conflict.path,
        success: !stillConflicted,
        changed,
        summary: `[GPT-5 + OpenCode/Sonnet dual-agent - APPROVED]\n\nReason: ${reviewDecision.reason}`,
        error: stillConflicted ? "Approved but markers still present" : undefined,
      };
    } else if (decision === "needs_fixes" && attempt === 1) {
      // Extract specific feedback and issues
      const feedback = reviewDecision.feedback || reviewDecision.reason;
      const issues = reviewDecision.issues || [];

      logInfo("worker", `GPT-5 requested fixes: ${issues.length} issues identified`, conflict.path);

      // Build structured feedback for OpenCode
      let issuesList = "";
      if (issues.length > 0) {
        issuesList = "\n\n## Specific Issues to Fix:\n" +
          issues.map((issue: any, i: number) =>
            `${i + 1}. ${issue.line ? `Line ${issue.line}: ` : ""}${issue.issue}\n   Fix: ${issue.fix}`
          ).join("\n");
      }

      // OpenCode retries with supervisor feedback
      const retryPrompt = `# Retry Merge Resolution with Specific Fixes

The GPT-5 supervisor identified issues that need to be fixed:

## Main Feedback
${feedback}${issuesList}

## File location
${conflict.path}

Apply these specific fixes exactly as described:
1. Read the current file
2. Fix each issue mentioned above
3. Ensure all conflict markers are removed
4. Write the corrected file
5. Verify with: rg '<<<<<<<' ${conflict.path}`;

      const retryResult = await opencodeAgent.delegate(retryPrompt);

      logInfo("worker", `OpenCode/Sonnet retry: ${retryResult.success ? "success" : "failed"}`, conflict.path);

      // GPT-5 reviews the retry
      const [retryContent, retryRemaining] = await Promise.all([
        this.git.readWorkingFile(conflict.path),
        this.git.listConflictPaths(),
      ]);

      const retryMarkers = retryContent ? countMarkers(retryContent) : 0;
      const retryStillConflicted = retryMarkers > 0 || retryRemaining.includes(conflict.path);

      const finalReviewPrompt = `Review OpenCode's retry after applying your feedback.

Your Previous Feedback:
${feedback}${issuesList}

OpenCode's Response:
${retryResult.output ? retryResult.output.slice(0, 800) : "(no response)"}

Current Status:
- Conflict markers: ${retryMarkers}
- Resolution successful: ${!retryStillConflicted}

Current File (first 2000 chars):
${retryContent ? retryContent.slice(0, 2000) : "(not available)"}

Make a final decision: approve if fixed correctly, or reject if still wrong.`;

      const finalReviewTurn = await runThreadTurnWithLogs(
        supervisorThread,
        this.logger("worker", `${conflict.path}:gpt5-supervisor`),
        finalReviewPrompt,
        { outputSchema: MERGE_REVIEW_OUTPUT_SCHEMA }
      );

      // Parse the final review
      let finalReviewDecision: any;
      try {
        finalReviewDecision = JSON.parse(finalReviewTurn.finalResponse ?? "{}");
      } catch (e) {
        finalReviewDecision = { decision: "rejected", reason: "Failed to parse review" };
      }

      const approved = finalReviewDecision.decision === "approved";

      if (approved && !retryStillConflicted) {
        logInfo("worker", "GPT-5 supervisor APPROVED the retry", conflict.path);
        const stagingPrompt = `Stage the resolved file by running: git add ${conflict.path}`;
        await opencodeAgent.delegate(stagingPrompt);
      } else {
        logWarn("worker", "GPT-5 supervisor REJECTED the retry", conflict.path);
      }

      return {
        path: conflict.path,
        success: approved && !retryStillConflicted,
        changed: true,
        summary: `[GPT-5 + OpenCode/Sonnet dual-agent - ${approved ? "APPROVED after fixes" : "REJECTED"}]\n\nInitial issues: ${issues.length}\nFinal decision: ${finalReviewDecision.reason}`,
        error: approved ? undefined : finalReviewDecision.reason,
      };
    } else if (decision === "rejected") {
      // GPT-5 rejected the approach
      logWarn("worker", "GPT-5 supervisor REJECTED the resolution", conflict.path);

      return {
        path: conflict.path,
        success: false,
        changed,
        summary: `[GPT-5 + OpenCode/Sonnet dual-agent - REJECTED]\n\nReason: ${reviewDecision.reason}`,
        error: reviewDecision.reason,
      };
    }

    // Default case - treat as rejection if no clear decision
    logWarn("worker", "GPT-5 supervisor gave unclear decision, treating as rejection", conflict.path);

    return {
      path: conflict.path,
      success: false,
      changed,
      summary: `[GPT-5 + OpenCode/Sonnet dual-agent - UNCLEAR]\n\nDecision: ${decision}`,
      error: "Supervisor decision unclear: " + decision,
    };
  }

  private async finalizeResolution(
    conflict: ConflictContext,
    thread: Thread,
    beforeContent: string | null,
    summary: string
  ): Promise<WorkerOutcome> {
    const afterContent = await this.git.readWorkingFile(conflict.path);
    const changed = beforeContent !== afterContent;

    // Verification and staging
    const verificationPrompt = buildQuickVerificationPrompt(conflict.path);
    await runThreadTurnWithLogs(thread, this.logger("worker", conflict.path), verificationPrompt);

    const [verifiedContent, remaining] = await Promise.all([
      this.git.readWorkingFile(conflict.path),
      this.git.listConflictPaths(),
    ]);

    let markerCount = verifiedContent ? countMarkers(verifiedContent) : 0;
    let gitConflicted = remaining.includes(conflict.path);
    let stillConflicted = markerCount > 0;

    // Stage if clean
    if (!stillConflicted && gitConflicted) {
      const stagingPrompt = buildQuickStagingPrompt(conflict.path);
      await runThreadTurnWithLogs(thread, this.logger("worker", conflict.path), stagingPrompt);

      const newRemaining = await this.git.listConflictPaths();
      gitConflicted = newRemaining.includes(conflict.path);
    }

    const statusLabel = stillConflicted
      ? "conflict persists"
      : gitConflicted
      ? "content clean but not staged"
      : "resolved and staged";

    logInfo("worker", statusLabel, conflict.path);

    this.approvalSupervisor?.setContext(null);
    this.finalizeWorkerPlan(thread, conflict.path, !stillConflicted && !gitConflicted);

    return {
      path: conflict.path,
      success: !stillConflicted && !gitConflicted,
      changed,
      summary,
      threadId: thread.id ?? undefined,
      error: stillConflicted || gitConflicted ? "File remains conflicted or unstaged." : undefined,
    };
  }

  private async resolveConflictWithParallelAnalysis(
    conflict: ConflictContext,
    attempt = 1,
  ): Promise<WorkerOutcome> {
    logInfo("worker", "Using parallel analysis approach", conflict.path);

    const beforeContent = await this.git.readWorkingFile(conflict.path);
    const reasoningEffort = this.selectReasoningEffort(conflict, attempt);
    const workerModel = this.selectWorkerModelForConflict(conflict);

    // Step 1: Spawn 3 parallel analysis threads
    logInfo("worker", "Launching parallel analysis threads (ours, theirs, intent)", conflict.path);

    const analysisThreadOptions: ThreadOptions = {
      ...this.workerThreadOptions,
      model: this.options.workerModelLow ?? this.options.workerModel,
      reasoningEffort: "low",
    };

    const [oursThread, theirsThread, intentThread] = await Promise.all([
      this.threads.start(analysisThreadOptions),
      this.threads.start(analysisThreadOptions),
      this.threads.start(analysisThreadOptions),
    ]);

    const [oursTurn, theirsTurn, intentTurn] = await Promise.all([
      runThreadTurnWithLogs(
        oursThread,
        this.logger("worker", `${conflict.path}:ours`),
        buildOursAnalysisPrompt(conflict)
      ),
      runThreadTurnWithLogs(
        theirsThread,
        this.logger("worker", `${conflict.path}:theirs`),
        buildTheirsAnalysisPrompt(conflict)
      ),
      runThreadTurnWithLogs(
        intentThread,
        this.logger("worker", `${conflict.path}:intent`),
        buildIntentAnalysisPrompt(conflict)
      ),
    ]);

    const oursAnalysis = oursTurn.finalResponse ?? "(no analysis)";
    const theirsAnalysis = theirsTurn.finalResponse ?? "(no analysis)";
    const intentAnalysis = intentTurn.finalResponse ?? "(no analysis)";

    logInfo("worker", "Parallel analysis complete, launching integration", conflict.path);

    // Step 2: Integration thread with aggregated insights
    const integrationThread = await this.acquireWorkerThread(conflict.path, workerModel, reasoningEffort);
    this.setWorkerPlan(integrationThread, conflict.path);

    const integrationPrompt = buildIntegrationPrompt(
      conflict,
      oursAnalysis,
      theirsAnalysis,
      intentAnalysis
    );

    this.approvalSupervisor?.setContext({
      conflictPath: conflict.path,
      coordinatorPlan: this.coordinatorPlan,
      remoteInfo: this.remoteComparison,
      extraNotes: `Parallel analysis: ours=${oursAnalysis.length}chars, theirs=${theirsAnalysis.length}chars, intent=${intentAnalysis.length}chars`,
    });

    try {
      const resolutionTurn = await runThreadTurnWithLogs(
        integrationThread,
        this.logger("worker", conflict.path),
        integrationPrompt
      );

      const summaryText = resolutionTurn.finalResponse ?? "";
      const afterContent = await this.git.readWorkingFile(conflict.path);
      const changed = beforeContent !== afterContent;

      if (!changed) {
        logWarn("worker", "No edits detected after parallel analysis resolution", conflict.path);
      }

      // Step 3: Verification (parallel checks)
      logInfo("worker", "Requesting verification", conflict.path);
      const verificationPrompt = buildVerificationPrompt(conflict.path);
      await runThreadTurnWithLogs(
        integrationThread,
        this.logger("worker", conflict.path),
        verificationPrompt
      );

      const [verifiedContent, remaining] = await Promise.all([
        this.git.readWorkingFile(conflict.path),
        this.git.listConflictPaths(),
      ]);

      let markerCount = verifiedContent ? countMarkers(verifiedContent) : 0;
      let gitConflicted = remaining.includes(conflict.path);
      let stillConflicted = markerCount > 0;

      // Step 4: Staging if clean
      if (!stillConflicted && gitConflicted) {
        logInfo("worker", "Requesting staging", conflict.path);
        const stagingPrompt = buildStagingPrompt(conflict.path);
        await runThreadTurnWithLogs(
          integrationThread,
          this.logger("worker", conflict.path),
          stagingPrompt
        );

        const newRemaining = await this.git.listConflictPaths();
        gitConflicted = newRemaining.includes(conflict.path);
      }

      let statusLabel: string;
      if (stillConflicted) {
        statusLabel = changed ? "conflict persists (edits applied)" : "conflict persists (no edits)";
      } else if (gitConflicted) {
        statusLabel = "content clean but not staged";
      } else {
        statusLabel = "resolved and staged";
      }
      logInfo("worker", `${statusLabel} [parallel analysis]`, conflict.path);

      this.approvalSupervisor?.setContext(null);
      this.finalizeWorkerPlan(integrationThread, conflict.path, !stillConflicted && !gitConflicted);

      return {
        path: conflict.path,
        success: !stillConflicted && !gitConflicted,
        changed,
        summary: `[Parallel analysis used]\n\n${summaryText}`,
        threadId: integrationThread.id ?? undefined,
        error:
          stillConflicted || gitConflicted
            ? "File remains conflicted or unstaged after parallel analysis."
            : undefined,
      };
    } catch (error: any) {
      this.approvalSupervisor?.setContext(null);
      this.finalizeWorkerPlan(integrationThread, conflict.path, false);
      const afterContent = await this.git.readWorkingFile(conflict.path);
      const changed = beforeContent !== afterContent;
      logWarn("worker", `Parallel analysis failed: ${error}`, conflict.path);
      return {
        path: conflict.path,
        success: false,
        changed,
        error: error instanceof Error ? error.message : String(error),
        threadId: integrationThread.id ?? undefined,
      };
    }
  }

  async run(): Promise<void> {
    await this.ensureUpstreamMerge();
    logInfo("worker", "initialize → scanning for conflicts");
    logInfo("git", "Collecting merge conflicts via git diff --diff-filter=U");
    const conflicts = await this.git.collectConflicts({
      originRef: this.options.originRef,
      upstreamRef: this.options.upstreamRef,
    });
    if (conflicts.length === 0) {
      logInfo("merge", "No merge conflicts detected. Exiting early.");
      this.logTokenTotals();
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
    const snapshot = await collectRepoSnapshot(this.git, conflicts, this.remoteComparison);

    await this.startCoordinator(snapshot);
    this.syncCoordinatorBoard([]);

    const outcomes: WorkerOutcome[] = [];
    const simpleConflicts = conflicts.filter((c) => this.conflictIsSimple(c));
    const complexConflicts = conflicts.filter((c) => !this.conflictIsSimple(c));
    logInfo(
      "worker",
      `plan ready → resolving conflicts (simple first, then complex); ${simpleConflicts.length} simple, ${complexConflicts.length} complex`,
    );
    // Only process one file at a time; agents within a file (worker, reviewer, validation) may still run.
    const maxConcurrentWorkers = 1;
    const maxAttemptsPerConflict = 2;
    const active = new Set<Promise<void>>();

    const recordOutcome = (outcome: WorkerOutcome): void => {
      outcomes.push(outcome);
      this.syncCoordinatorBoard(outcomes);
    };

    const resolveWithRetry = async (conflict: ConflictContext): Promise<WorkerOutcome> => {
      let attempt = 1;
      let outcome: WorkerOutcome;
      let supervisorFeedback: string | null = null;
      const isSimple = this.conflictIsSimple(conflict);

      // Strategy selection:
      // - Simple conflicts → single-thread resolution
      // - Complex conflicts → dual-agent (GPT-5 supervisor + OpenCode/Sonnet worker)
      // - Fallback → parallel analysis (if OpenCode not enabled)
      const useDualAgent = !isSimple && this.options.useOpenCodeAgent !== false;
      const useParallel = !isSimple && !useDualAgent;

      do {
        const strategyLabel = useDualAgent ? "[dual-agent]" : useParallel ? "[parallel]" : "";
        logInfo(
          "worker",
          `attempt ${attempt}/${maxAttemptsPerConflict} → ${conflict.path} ${strategyLabel}`,
          conflict.path,
        );

        // Route to appropriate resolution strategy
        outcome = useDualAgent
          ? await this.resolveConflictWithDualAgent(conflict, attempt)
          : useParallel
          ? await this.resolveConflictWithParallelAnalysis(conflict, attempt)
          : await this.resolveConflict(conflict, attempt, supervisorFeedback);

        if (outcome.success) {
          return outcome;
        }

        if (attempt >= maxAttemptsPerConflict) {
          break;
        }

        // Run per-file feedback review to generate concrete guidance for the next attempt.
        supervisorFeedback = await this.runPerFileReviewer(conflict, outcome);

        attempt += 1;
        this.workerThreads.delete(conflict.path);
        logWarn(
          "worker",
          `retry queued ${conflict.path} (attempt ${attempt}/${maxAttemptsPerConflict})`,
          conflict.path,
        );
      } while (attempt <= maxAttemptsPerConflict);
      return outcome;
    };

    // Process conflicts with concurrency limit (configurable via CX_MERGE_CONCURRENCY env var, default 4)
    const CONCURRENCY_LIMIT = parseInt(process.env.CX_MERGE_CONCURRENCY || "4", 10);
    const allConflicts = [...simpleConflicts, ...complexConflicts];

    for (let i = 0; i < allConflicts.length; i += CONCURRENCY_LIMIT) {
      const batch = allConflicts.slice(i, Math.min(i + CONCURRENCY_LIMIT, allConflicts.length));

      logInfo("merge", `Processing batch of ${batch.length} conflicts in parallel (max concurrency: ${CONCURRENCY_LIMIT})`);

      // Process batch in parallel
      const batchOutcomes = await Promise.all(
        batch.map(async (conflict) => {
          const outcome = await resolveWithRetry(conflict);
          return { conflict, outcome };
        })
      );

      // Record outcomes and check for unresolved conflicts
      let shouldStop = false;
      for (const { conflict, outcome } of batchOutcomes) {
        recordOutcome(outcome);

        const currentContent = await this.git.readWorkingFile(conflict.path);
        const markerCount = currentContent ? countMarkers(currentContent) : 0;

        if (markerCount > 0) {
          logWarn(
            "merge",
            `Stopping after ${conflict.path}: conflict markers still present; not processing further files`,
            conflict.path,
          );
          shouldStop = true;
        }
      }

      if (shouldStop) {
        break;
      }
    }

    logInfo("worker", "resolution attempts complete → summarizing outcomes");
    const resolvedCount = outcomes.filter((o) => o.success).length;
    const unresolvedChanged = outcomes.filter((o) => !o.success && o.changed).length;
    const unresolvedUnchanged = outcomes.filter((o) => !o.success && !o.changed).length;
    logInfo(
      "merge",
      `Outcome summary: resolved=${resolvedCount}, unresolved_with_edits=${unresolvedChanged}, unresolved_no_edits=${unresolvedUnchanged}`,
    );

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

    this.logTokenTotals();
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

  private async startCoordinator(snapshot: RepoSnapshot): Promise<void> {
    this.coordinatorThread = this.threads.start(this.coordinatorThreadOptions);
    const coordinatorPrompt = buildCoordinatorPrompt(snapshot);
    logInfo("coordinator", "Launching coordinator agent for global merge plan");
    const turn = await runThreadTurnWithLogs(
      this.coordinatorThread,
      this.logger("coordinator"),
      coordinatorPrompt,
    );
    this.coordinatorPlan = turn.finalResponse ?? null;
    this.coordinatorUserMessageCount += 1;
    if (this.coordinatorPlan) {
      logInfo("coordinator", "Coordinator issued plan:");
      console.log(this.coordinatorPlan);
    }
  }

  private selectReasoningEffort(
    conflict: ConflictContext,
    attempt: number,
  ): ThreadOptions["reasoningEffort"] | undefined {
    // If the caller explicitly configured a reasoningEffort (including "xhigh"),
    // respect it and do not override.
    if (this.options.reasoningEffort) {
      return this.options.reasoningEffort;
    }

    const base: ThreadOptions["reasoningEffort"] = "medium";
    const severityScore =
      (conflict.lineCount ?? 0) + (conflict.conflictMarkers ?? 0) * 200;
    if (attempt > 1 || severityScore >= 800) {
      return "high";
    }
    return base;
  }

  private async resolveConflict(
    conflict: ConflictContext,
    attempt = 1,
    supervisorFeedback: string | null = null,
  ): Promise<WorkerOutcome> {
    logInfo("worker", "Dispatching worker", conflict.path);
    const workerId = `worker-${conflict.path.replace(/[^a-zA-Z0-9]/g, "-")}`;

    const beforeContent = await this.git.readWorkingFile(conflict.path);
    const workerModel = this.selectWorkerModelForConflict(conflict);
    const reasoningEffort = this.selectReasoningEffort(conflict, attempt);
    const workerThread = await this.acquireWorkerThread(conflict.path, workerModel, reasoningEffort);

    this.setWorkerPlan(workerThread, conflict.path);

    const prompt = buildWorkerPrompt(
      conflict,
      this.coordinatorPlan,
      {
        originRef: this.options.originRef,
        upstreamRef: this.options.upstreamRef,
      },
      supervisorFeedback,
    );

    this.approvalSupervisor?.setContext({
      conflictPath: conflict.path,
      coordinatorPlan: this.coordinatorPlan,
      remoteInfo: this.remoteComparison,
      extraNotes: "Worker is preparing to resolve this file.",
    });

    try {
      // Step 1: Send initial resolution prompt
      logInfo("worker", "Sending resolution prompt", conflict.path);
      const resolutionTurn = await runThreadTurnWithLogs(workerThread, this.logger("worker", conflict.path), prompt);

      const summaryText = resolutionTurn.finalResponse ?? "";
      const afterContent = await this.git.readWorkingFile(conflict.path);
      const changed = beforeContent !== afterContent;

      if (!changed) {
        logWarn("worker", "No edits detected after resolution phase", conflict.path);
      }

      // Step 2: Ask agent to verify no conflict markers remain
      logInfo("worker", "Requesting verification", conflict.path);
      const verificationPrompt = buildVerificationPrompt(conflict.path);
      const verificationTurn = await runThreadTurnWithLogs(
        workerThread,
        this.logger("worker", conflict.path),
        verificationPrompt
      );

      // Check actual state after verification (parallelize checks)
      const [verifiedContent, remaining] = await Promise.all([
        this.git.readWorkingFile(conflict.path),
        this.git.listConflictPaths(),
      ]);
      let markerCount = verifiedContent ? countMarkers(verifiedContent) : 0;
      let gitConflicted = remaining.includes(conflict.path);
      let stillConflicted = markerCount > 0;

      // Step 3: If verified clean, ask agent to stage the file
      if (!stillConflicted && gitConflicted) {
        logInfo("worker", "Requesting staging", conflict.path);
        const stagingPrompt = buildStagingPrompt(conflict.path);
        const stagingTurn = await runThreadTurnWithLogs(
          workerThread,
          this.logger("worker", conflict.path),
          stagingPrompt
        );

        // Re-check after staging
        const updatedRemaining = await this.git.listConflictPaths();
        gitConflicted = updatedRemaining.includes(conflict.path);
      }

      let statusLabel: string;
      if (stillConflicted) {
        statusLabel = changed ? "conflict persists (edits applied)" : "conflict persists (no edits)";
      } else if (gitConflicted) {
        statusLabel = "content clean but not staged";
      } else {
        statusLabel = "resolved and staged";
      }
      logInfo("worker", `${statusLabel}`, conflict.path);

      this.approvalSupervisor?.setContext(null);
      this.finalizeWorkerPlan(workerThread, conflict.path, !stillConflicted && !gitConflicted);

      return {
        path: conflict.path,
        success: !stillConflicted && !gitConflicted,
        changed,
        summary: summaryText || undefined,
        threadId: workerThread.id ?? undefined,
        error:
          stillConflicted || gitConflicted
            ? "File remains conflicted or unstaged after worker interaction."
            : undefined,
      };
    } catch (error: any) {
      this.approvalSupervisor?.setContext(null);
      this.finalizeWorkerPlan(workerThread, conflict.path, false);
      const afterContent = await this.git.readWorkingFile(conflict.path);
      const changed = beforeContent !== afterContent;
      logWarn("worker", `Worker failed: ${error}`, conflict.path);
      return {
        path: conflict.path,
        success: false,
        changed,
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
    const reviewerThread = this.threads.start(this.reviewerThreadOptions);
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
      this.logger(validationMode ? "validation" : "reviewer"),
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
      const thread = this.threads.start(this.workerThreadOptions);
      const prompt = buildValidationPrompt(outcome.path, outcome.summary ?? "");
      const turn = await runThreadTurnWithLogs(thread, this.logger("validation", outcome.path), prompt);
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
    const ciId = "ci-runner";

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
    const ciLogTokens = tokenizerCount(ciLog);
    const preparedLog =
      ciLogTokens <= CI_LOG_CONTEXT_TOKENS
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
          await runThreadTurnWithLogs(thread, this.logger("worker", outcome.path), prompt);
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
          await runThreadTurnWithLogs(thread, this.logger("worker", matchedOutcome.path), prompt);
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
        await runThreadTurnWithLogs(ciThread, this.logger("worker", failure.label), prompt);
        this.setCiPlan(ciThread, failure.label, true);
      } catch (error) {
        logWarn("worker", `CI specialist thread failed: ${error}`, failure.label);
      }
    }
  }

  private async prepareOverflowCiLog(ciLog: string, snippetSection: string | null): Promise<string> {
    const tokenCapLabel = CI_OVERFLOW_SUMMARY_MAX_TOKENS.toLocaleString();
    const ciLogTokens = tokenizerCount(ciLog);
    logInfo(
      "merge",
      `CI log is ${ciLogTokens} tokens (limit ${CI_LOG_CONTEXT_TOKENS}); summarizing overflow with codex-mini (~${tokenCapLabel} token cap).`,
    );
    // Use character approximation for slicing (4 chars per token on average)
    const approximateCharsForTokenLimit = CI_LOG_CONTEXT_TOKENS * 4;
    const suffix = ciLog.slice(-approximateCharsForTokenLimit);
    const overflow = ciLog.slice(0, ciLog.length - suffix.length);
    let body = suffix;
    if (overflow.length > 0) {
      const { chunk, skippedPrefix } = clampOverflowForSummary(overflow);
      const summary = await this.summarizeCiOverflow({
        chunk,
        totalOverflowChars: overflow.length,
        skippedPrefix,
      });
      const chunkDescriptor = skippedPrefix
        ? `last ${chunk.length} chars (skipped ${skippedPrefix} leading chars)`
        : `${chunk.length} chars`;
      const summarySection = summary
        ? `[Overflow summary via codex-mini (~${tokenCapLabel} token cap); ${overflow.length} older chars condensed using ${chunkDescriptor}]\n${summary}\n\n`
        : "[Overflow summary unavailable due to summarizer error]\n\n";
      body = `${summarySection}${suffix}`;
    }
    const withSummary = snippetSection ? `${body}\n\n${snippetSection}` : body;
    return withSummary;
  }

  private async summarizeCiOverflow(params: {
    chunk: string;
    totalOverflowChars: number;
    skippedPrefix: number;
  }): Promise<string | null> {
    const { chunk, totalOverflowChars, skippedPrefix } = params;
    const tokenCapLabel = CI_OVERFLOW_SUMMARY_MAX_TOKENS.toLocaleString();
    try {
      const summaryThread = this.threads.start({
        ...this.workerThreadOptions,
        model: this.options.workerModelLow ?? DEFAULT_WORKER_MODEL,
      });
      const coverageNote = skippedPrefix
        ? `Overflow totals ${totalOverflowChars} chars; only the last ${chunk.length} chars are provided (skipped ${skippedPrefix}) to stay within the ~${tokenCapLabel}-token mini-model window.`
        : `Overflow totals ${totalOverflowChars} chars and fits within the ~${tokenCapLabel}-token mini-model window.`;
      const prompt = `Summarize the following CI log overflow into concise bullets highlighting failing crates/tests and key errors. Limit to 300 words. ${coverageNote}\n\nOverflow log (truncated as described):\n${chunk}`;
      const turn = await runThreadTurnWithLogs(summaryThread, this.logger("worker", "ci-overflow"), prompt);
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
        } catch (error) {
          logWarn("worker", `Invalid regex pattern '${pattern}': ${error}`, filePath);
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

  private async acquireWorkerThread(
    filePath: string,
    modelOverride?: string,
    reasoningEffort?: ThreadOptions["reasoningEffort"],
  ): Promise<Thread> {
    const existing = this.workerThreads.get(filePath);
    if (existing) {
      return existing;
    }
    const model = modelOverride ?? this.selectWorkerModel(filePath);
    const threadOptions: ThreadOptions = {
      ...this.workerThreadOptions,
      model,
      reasoningEffort: reasoningEffort ?? this.workerThreadOptions.reasoningEffort,
    };
    if (this.coordinatorThread) {
      try {
        const forked = await this.threads.fork(this.coordinatorThread, {
          nthUserMessage: this.coordinatorUserMessageCount,
          threadOptions,
        });
        this.workerThreads.set(filePath, forked);
        return forked;
      } catch (error) {
        logWarn("worker", `Unable to fork coordinator for ${filePath}; starting standalone thread`, filePath);
      }
    }
    const thread = this.threads.start(threadOptions);
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
        thread = await this.threads.fork(this.coordinatorThread, {
          nthUserMessage: this.coordinatorUserMessageCount,
          threadOptions,
        });
        this.ciThreads.set(label, thread);
        return thread;
      } catch (error) {
        logWarn("worker", `Unable to fork coordinator for CI thread "${label}"; starting standalone`, label);
      }
    }
    thread = this.threads.start(threadOptions);
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
    } catch (error) {
      logWarn("coordinator", `Failed to update coordinator board: ${error}`);
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
    } catch (error) {
      logWarn("worker", `Failed to update thread plan: ${error}`, path);
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
    } catch (error) {
      logWarn("worker", `Failed to update thread plan: ${error}`, path);
    }
  }

  // Store logger state at class level to persist across calls
  private loggerState = new Map<string, {
    reasoningStartTime: number | null;
    toolCallCount: number;
    lastReasoningCompletion: number;
    reasoningSessionId: number;
    lastReasoningContent: string;
    duplicateCount: number;
  }>();

  private logger(scope: LogScope, subject?: string) {
    const base = createThreadLogger(scope, subject);
    const stateKey = `${scope}_${subject || 'default'}`;

    // Get or create persistent state for this logger
    if (!this.loggerState.has(stateKey)) {
      this.loggerState.set(stateKey, {
        reasoningStartTime: null,
        toolCallCount: 0,
        lastReasoningCompletion: 0,
        reasoningSessionId: 0,
        lastReasoningContent: "",
        duplicateCount: 0
      });
    }
    const state = this.loggerState.get(stateKey)!;

    return {
      ...base,
      info: (message: string) => {
        // Intercept and enhance various log messages for better visibility
        if (message.startsWith("Item completed: reasoning →")) {
          // Extract reasoning content (everything after the arrow)
          const reasoningContent = message.substring(message.indexOf("→") + 1).trim();
          const preview = reasoningContent.length > 500
            ? reasoningContent.substring(0, 500) + "..."
            : reasoningContent;

          // Check if this is a duplicate of the last reasoning
          const now = Date.now();
          const isDuplicate = (reasoningContent === state.lastReasoningContent) ||
                            (now - state.lastReasoningCompletion < 500 && state.lastReasoningContent.startsWith(reasoningContent.substring(0, 50)));

          if (isDuplicate) {
            state.duplicateCount++;
            // Only show every 5th duplicate to reduce spam
            if (state.duplicateCount % 5 === 0) {
              base.info(`[REASONING] (duplicate x${state.duplicateCount}) Still processing...`);
            }
            state.lastReasoningCompletion = now;
            return;
          }

          // New reasoning content
          state.duplicateCount = 0;
          state.lastReasoningContent = reasoningContent;
          state.lastReasoningCompletion = now;

          if (state.reasoningStartTime) {
            const duration = Date.now() - state.reasoningStartTime;
            base.info(`[REASONING #${state.reasoningSessionId}] Completed (${Math.round(duration / 1000)}s): ${preview}`);
            state.reasoningStartTime = null;
          } else {
            base.info(`[REASONING UPDATE]: ${preview}`);
          }
        } else if (message.startsWith("Item started: reasoning →")) {
          state.reasoningStartTime = Date.now();
          state.reasoningSessionId++;
          state.duplicateCount = 0;
          base.info(`[REASONING #${state.reasoningSessionId}] Started - analyzing conflict...`);
        } else if (message.includes("command")) {
          // Highlight ALL shell commands (not just completed/in_progress)
          state.toolCallCount++;
          const status = message.includes("[completed") ? "✓" :
                       message.includes("[failed") ? "✗" :
                       message.includes("[in_progress") ? "→" : "";
          base.info(`[SHELL ${state.toolCallCount}${status}] ${message}`);
        } else if (message.includes("file change") || message.includes("file_change")) {
          // Highlight file operations (catch both formats)
          state.toolCallCount++;
          base.info(`[FILE ${state.toolCallCount}] ${message}`);
        } else if (message.includes("mcp") || message.includes("tool_call")) {
          // Highlight MCP and general tool calls
          state.toolCallCount++;
          base.info(`[MCP ${state.toolCallCount}] ${message}`);
        } else if (message.includes("web search") || message.includes("web_search")) {
          // Highlight web searches
          state.toolCallCount++;
          base.info(`[WEB ${state.toolCallCount}] ${message}`);
        } else if (message.includes("read_file") || message.includes("Read file")) {
          // Highlight file reads specifically
          state.toolCallCount++;
          base.info(`[READ ${state.toolCallCount}] ${message}`);
        } else if (message.includes("write_file") || message.includes("Write file")) {
          // Highlight file writes specifically
          state.toolCallCount++;
          base.info(`[WRITE ${state.toolCallCount}] ${message}`);
        } else if (message.includes("Item started:") || message.includes("Item completed:")) {
          // Show other items more clearly
          if (message.includes("agent message")) {
            base.info(`[AGENT] ${message}`);
          } else if (message.includes("error")) {
            base.warn(`[ERROR] ${message}`);
          } else {
            base.info(`[EVENT] ${message}`);
          }
        } else {
          base.info(message);
        }
      },
      warn: base.warn,
      recordUsage: (usage: Usage) => {
        this.tokenTracker.record(usage);
      },
    };
  }

  private logTokenTotals(): void {
    logInfo("merge", `Token usage: ${this.tokenTracker.summary()}`);
  }

  private async runPerFileReviewer(
    conflict: ConflictContext,
    outcome: WorkerOutcome,
  ): Promise<string | null> {
    logInfo("reviewer", `Launching per-file feedback reviewer for ${conflict.path}`, conflict.path);
    const reviewerThread = this.threads.start(this.reviewerThreadOptions);
    const prompt = buildPerFileReviewPrompt(conflict, outcome);
    try {
      const turn = await runThreadTurnWithLogs(
        reviewerThread,
        this.logger("reviewer", conflict.path),
        prompt,
      );
      const summary = turn.finalResponse ?? null;
      if (summary) {
        logInfo("reviewer", "Per-file reviewer produced feedback", conflict.path);
      } else {
        logWarn("reviewer", "Per-file reviewer returned no feedback", conflict.path);
      }
      return summary;
    } catch (error) {
      logWarn("reviewer", `Per-file reviewer failed: ${error}`, conflict.path);
      return null;
    }
  }

}

export function createDefaultSolverConfig(workingDirectory: string): SolverConfig {
  return {
    workingDirectory,
    coordinatorModel: DEFAULT_COORDINATOR_MODEL,
    workerModel: DEFAULT_WORKER_MODEL,
    reviewerModel: DEFAULT_REVIEWER_MODEL,
    supervisorModel: "gpt-5.1-codex",
    workerModelHigh: DEFAULT_REVIEWER_MODEL,
    workerModelLow: DEFAULT_WORKER_MODEL,
    // Enable OpenCode dual-agent pattern by default
    // GPT-5 supervisor + OpenCode/Sonnet 4.5 worker
    useOpenCodeAgent: process.env.CX_MERGE_USE_OPENCODE !== "false",
    quickTaskModel: process.env.CX_MERGE_QUICK_MODEL ?? "gpt-5.1-codex",
    useFastVerification: true,
    highReasoningMatchers: ["^codex-rs/core/", "^codex-rs/app-server/", "^codex-rs/common/"],
    lowReasoningMatchers: ["^\\.github/", "^docs/", "README\\.md$"],
    sandboxMode: DEFAULT_SANDBOX_MODE,
    approvalMode: DEFAULT_APPROVAL_MODE,
    baseUrl: process.env.CODEX_BASE_URL,
    apiKey: undefined,  // Use global Codex auth
    skipGitRepoCheck: false,
    originRef: process.env.CX_MERGE_ORIGIN_REF ?? "HEAD",
    upstreamRef: process.env.CX_MERGE_UPSTREAM_REF ?? "upstream/main",
  };
}
