import { run } from "@openai/agents";
import { Codex, type Thread } from "@codex-native/sdk";
import type { AgentWorkflowConfig, CoordinatorInput } from "./types.js";
import type { WorkerOutcome, ConflictContext, RemoteComparison } from "../merge/types.js";
import { createCoordinatorAgent } from "./coordinator-agent.js";
import { createWorkerAgent, selectWorkerModel, formatWorkerInput } from "./worker-agent.js";
import { createReviewerAgent, formatReviewerInput } from "./reviewer-agent.js";
import { runOpenCodeResolution } from "./opencode-wrapper.js";
import { ApprovalSupervisor } from "../merge/supervisor.js";
import { GitRepo } from "../merge/git.js";
import { logInfo, logWarn } from "../merge/logging.js";

const DEFAULT_OPEN_CODE_SEVERITY_THRESHOLD = 1200;

/**
 * Agent workflow orchestrator using @openai/agents SDK.
 * Drives: Coordinator → Worker(s) → Reviewer pipeline.
 */
export class AgentWorkflowOrchestrator {
  private readonly git: GitRepo;
  private readonly approvalSupervisor: ApprovalSupervisor | null;
  private supervisorLogThread: Thread | null;
  private coordinatorThread: Thread | null = null;
  private readonly activeFiles = new Set<string>();
  private readonly pathLocks = new Map<string, Promise<void>>();

  constructor(private readonly config: AgentWorkflowConfig) {
    this.git = new GitRepo(this.config.workingDirectory);
    const { supervisor, logThread } = this.buildSupervisor();
    this.approvalSupervisor = supervisor;
    this.supervisorLogThread = logThread;
  }

  async execute(input: CoordinatorInput): Promise<{
    success: boolean;
    outcomes: WorkerOutcome[];
    coordinatorPlan: string | null;
    transcript: string;
  }> {
    logInfo("agent", "Starting agent-based merge workflow");

    // Phase 1: Coordinator plans global strategy
    const coordinatorPlan = await this.runCoordinatorPhase(input);
    await this.syncSupervisorContext(coordinatorPlan, input);

    // Phase 2: Workers resolve individual conflicts
    const workerOutcomes = await this.runWorkerPhase(
      input.conflicts,
      coordinatorPlan,
      input.remoteComparison ?? null,
    );

    // Phase 3: Reviewer validates overall outcome
    const reviewerSummary = await this.runReviewerPhase(workerOutcomes, input.remoteComparison);

    const success = workerOutcomes.every((o) => o.success) && (await this.isAllResolved());
    if (success) {
      // Optional validation pass to surface any lingering issues post-merge.
      await this.runReviewerPhase(workerOutcomes, input.remoteComparison, true);
    }
    const transcript = this.generateTranscript(coordinatorPlan, workerOutcomes, reviewerSummary);

    return {
      success,
      outcomes: workerOutcomes,
      coordinatorPlan,
      transcript,
    };
  }

  private async syncSupervisorContext(plan: string | null, snapshot: CoordinatorInput): Promise<void> {
    if (!this.supervisorLogThread) {
      return;
    }
    try {
      const statusLine = snapshot.statusShort ?? "<status unavailable>";
      const diffStat = snapshot.diffStat ?? "<diffstat unavailable>";
      const remote = snapshot.remoteComparison
        ? `${snapshot.remoteComparison.originRef} ↔ ${snapshot.remoteComparison.upstreamRef}`
        : "(no remote comparison)";
      await this.supervisorLogThread.run(
        `Supervisor context\nStatus: ${statusLine}\nDiffstat: ${diffStat}\nRemote: ${remote}\nPlan:\n${(plan ?? "<none>").slice(0, 1500)}`,
      );
    } catch (error) {
      logWarn("supervisor", `Failed to log supervisor context: ${error}`);
    }
  }

  private async runCoordinatorPhase(input: CoordinatorInput): Promise<string | null> {
    logInfo("coordinator", "Running coordinator agent...");

    const { agent } = createCoordinatorAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      approvalMode: this.config.approvalMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.coordinatorModel,
      coordinatorInstructions: this.config.coordinatorInstructions,
      approvalSupervisor: this.approvalSupervisor,
    });

    const slimInput = this.shrinkCoordinatorInput(input);
    const result = await run(agent, JSON.stringify(slimInput));
    if (!result?.finalOutput || typeof result.finalOutput !== "string") {
      throw new Error("Coordinator produced invalid output");
    }
    return result.finalOutput;
  }

  private async runWorkerPhase(
    conflicts: CoordinatorInput["conflicts"],
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome[]> {
    logInfo("worker", `Processing ${conflicts.length} conflicts...`);

    const outcomes: WorkerOutcome[] = [];
    const simpleConflicts = conflicts.filter((c) => !this.isComplex(c));
    const complexConflicts = conflicts.filter((c) => this.isComplex(c));
    const maxConcurrent = Math.max(1, this.config.maxConcurrentSimpleWorkers ?? 1);
    const active = new Set<Promise<void>>();

    logInfo(
      "worker",
      `Queue split: ${simpleConflicts.length} simple, ${complexConflicts.length} complex (max ${maxConcurrent} simple in parallel)`,
    );

    const schedule = (conflict: ConflictContext): void => {
      const prior = this.pathLocks.get(conflict.path) ?? Promise.resolve();
      const task = prior
        .then(() => this.handleConflict(conflict, coordinatorPlan, remoteComparison))
        .then((outcome) => {
          outcomes.push(outcome);
        })
        .catch((error) => {
          logWarn("worker", `Unhandled error: ${error}`, conflict.path);
          outcomes.push({
            path: conflict.path,
            success: false,
            error: String(error),
          });
        })
        .finally(() => {
          this.activeFiles.delete(conflict.path);
          active.delete(task);
          this.pathLocks.delete(conflict.path);
        });
      active.add(task);
      this.pathLocks.set(conflict.path, task);
    };

    for (const conflict of simpleConflicts) {
      while (active.size >= maxConcurrent) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.race(active);
      }
      if (this.activeFiles.has(conflict.path)) {
        // wait for existing processing of same file
        // eslint-disable-next-line no-await-in-loop
        await Promise.race(active);
      }
      this.activeFiles.add(conflict.path);
      schedule(conflict);
    }

    if (active.size > 0) {
      await Promise.all(active);
    }

    for (const conflict of complexConflicts) {
      if (this.activeFiles.has(conflict.path)) {
        await Promise.all(active);
        this.activeFiles.delete(conflict.path);
      }
      this.activeFiles.add(conflict.path);
      const outcome = await this.handleConflict(conflict, coordinatorPlan, remoteComparison, true);
      outcomes.push(outcome);
      this.activeFiles.delete(conflict.path);
    }

    return outcomes;
  }

  private async runReviewerPhase(
    outcomes: WorkerOutcome[],
    remoteComparison: CoordinatorInput["remoteComparison"],
    validationMode = false,
  ): Promise<string | null> {
    logInfo(validationMode ? "validation" : "reviewer", "Running reviewer agent...");

    const { agent } = createReviewerAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.reviewerModel,
      reviewerInstructions: this.config.reviewerInstructions,
      approvalSupervisor: this.approvalSupervisor,
    });

    const status = await this.git.getStatusShort();
    const diffStat = await this.git.getDiffStat();
    const remaining = await this.git.listConflictPaths();

    const reviewerPrompt = formatReviewerInput({
      outcomes,
      remoteComparison: remoteComparison ?? null,
      status,
      diffStat,
      remaining,
      validationMode,
    });
    const result = await run(agent, reviewerPrompt);

    return result?.finalOutput ?? null;
  }

  private computeSeverity(conflict: ConflictContext): number {
    const markers = conflict.conflictMarkers ?? 0;
    const lines = conflict.lineCount ?? 0;
    return markers * 10 + lines;
  }

  private isComplex(conflict: ConflictContext): boolean {
    const threshold = this.config.openCodeSeverityThreshold ?? DEFAULT_OPEN_CODE_SEVERITY_THRESHOLD;
    return this.computeSeverity(conflict) >= threshold;
  }

  private async handleConflict(
    conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
    forceOpenCode = false,
  ): Promise<WorkerOutcome> {
    const workerOutcome = forceOpenCode
      ? null
      : await this.runWorkerAgent(conflict, coordinatorPlan, remoteComparison);

    if (workerOutcome?.success) {
      return workerOutcome;
    }

    // Fallback to OpenCode for complex or unresolved conflicts
    const openCodeOutcome = await this.runOpenCode(conflict, coordinatorPlan, remoteComparison);
    if (openCodeOutcome.success) {
      return openCodeOutcome;
    }

    return workerOutcome ?? openCodeOutcome;
  }

  private async runWorkerAgent(
    conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome> {
    const model = selectWorkerModel(conflict, {
      defaultModel: this.config.workerModel,
      highReasoningModel: this.config.workerModelHigh,
      lowReasoningModel: this.config.workerModelLow,
      highReasoningMatchers: this.config.highReasoningMatchers,
      lowReasoningMatchers: this.config.lowReasoningMatchers,
    });
    logInfo("worker", `Selected model '${model}'`, conflict.path);

    const { agent } = createWorkerAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      approvalMode: this.config.approvalMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model,
      conflictPath: conflict.path,
      workerInstructions: this.config.workerInstructions,
      approvalSupervisor: this.approvalSupervisor,
    });

    try {
      const workerPrompt = formatWorkerInput({ conflict, coordinatorPlan, remoteInfo: remoteComparison });
      const result = await run(agent, workerPrompt);
      if (!result?.finalOutput || typeof result.finalOutput !== "string") {
        throw new Error("Worker produced invalid output");
      }

      const summary = result.finalOutput;
      const resolved = await this.isResolved(conflict.path);

      return {
        path: conflict.path,
        success: resolved,
        summary: summary ?? undefined,
        error: resolved ? undefined : "Conflict still present after worker run",
      };
    } catch (error: any) {
      logWarn("worker", `Worker failed: ${error}`, conflict.path);
      return {
        path: conflict.path,
        success: false,
        error: error?.message ?? "Unknown worker error",
      };
    }
  }

  private async runOpenCode(
    conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteComparison: RemoteComparison | null,
  ): Promise<WorkerOutcome> {
    logInfo("worker", "Delegating to OpenCode (complex/unresolved)", conflict.path);
    const outcome = await runOpenCodeResolution(conflict, {
      workingDirectory: this.config.workingDirectory,
      sandboxMode: this.config.sandboxMode,
      approvalSupervisor: this.approvalSupervisor,
      model: this.config.workerModelHigh ?? this.config.workerModel,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      coordinatorPlan,
      remoteInfo: remoteComparison,
      approvalMode: this.config.approvalMode,
    });

    const resolved = await this.isResolved(conflict.path);
    return {
      ...outcome,
      success: outcome.success && resolved,
      error: resolved ? outcome.error : "Conflict still present after OpenCode run",
    };
  }

  private async isResolved(conflictPath: string): Promise<boolean> {
    const remaining = await this.git.listConflictPaths();
    return !remaining.includes(conflictPath);
  }

  private async isAllResolved(): Promise<boolean> {
    const remaining = await this.git.listConflictPaths();
    return remaining.length === 0;
  }

  private buildSupervisor(): { supervisor: ApprovalSupervisor | null; logThread: Thread | null } {
    const model = this.config.supervisorModel ?? this.config.coordinatorModel;
    if (!model) {
      return { supervisor: null, logThread: null };
    }
    try {
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const logThread = codex.startThread({
        model,
        sandboxMode: this.config.sandboxMode,
        approvalMode: this.config.approvalMode,
        workingDirectory: this.config.workingDirectory,
        skipGitRepoCheck: true,
      });
      const supervisor = new ApprovalSupervisor(
        codex,
        {
          model,
          workingDirectory: this.config.workingDirectory,
          sandboxMode: this.config.sandboxMode,
        },
        () => logThread,
      );
      if (!supervisor.isAvailable()) {
        return { supervisor: null, logThread: null };
      }
      return { supervisor, logThread };
    } catch (error) {
      logWarn("supervisor", `Unable to initialize approval supervisor: ${error}`);
      return { supervisor: null, logThread: null };
    }
  }

  private generateTranscript(
    coordinatorPlan: string | null,
    outcomes: WorkerOutcome[],
    reviewerSummary: string | null,
  ): string {
    const parts: string[] = [];

    parts.push("## Coordinator Plan\n");
    parts.push(coordinatorPlan ? coordinatorPlan.slice(0, 500) : "<no plan generated>");

    parts.push("\n\n## Worker Outcomes\n");
    for (const outcome of outcomes) {
      parts.push(`- ${outcome.path}: ${outcome.success ? "✓" : "✗"}`);
      if (outcome.summary) parts.push(` ${outcome.summary.slice(0, 100)}`);
      if (outcome.error) parts.push(` ERROR: ${outcome.error}`);
      parts.push("\n");
    }

    parts.push("\n## Reviewer Summary\n");
    parts.push(reviewerSummary ? reviewerSummary.slice(0, 500) : "<no summary>");

    return parts.join("");
  }

  private shrinkCoordinatorInput(input: CoordinatorInput): CoordinatorInput {
    const truncate = (text: string | null | undefined, max = 2000): string | null => {
      if (!text) return null;
      return text.length > max ? `${text.slice(0, max)}\n\n…truncated` : text;
    };

    const slimConflicts = input.conflicts.map((c) => ({
      path: c.path,
      language: c.language,
      lineCount: c.lineCount,
      conflictMarkers: c.conflictMarkers,
      diffExcerpt: truncate(c.diffExcerpt, 1800),
      workingExcerpt: truncate(c.workingExcerpt, 1200),
      baseExcerpt: null,
      oursExcerpt: null,
      theirsExcerpt: null,
      originRefContent: null,
      upstreamRefContent: null,
      originVsUpstreamDiff: null,
      baseVsOursDiff: null,
      baseVsTheirsDiff: null,
      oursVsTheirsDiff: null,
      recentHistory: null,
      localIntentLog: null,
    }));

    return {
      ...input,
      statusShort: truncate(input.statusShort, 1200) ?? "",
      diffStat: truncate(input.diffStat, 2000) ?? "",
      recentCommits: truncate(input.recentCommits, 1200) ?? "",
      conflicts: slimConflicts,
      remoteComparison: input.remoteComparison
        ? {
            ...input.remoteComparison,
            commitsMissingFromOrigin: truncate(input.remoteComparison.commitsMissingFromOrigin, 800),
            commitsMissingFromUpstream: truncate(input.remoteComparison.commitsMissingFromUpstream, 800),
            diffstatOriginToUpstream: truncate(input.remoteComparison.diffstatOriginToUpstream, 800),
            diffstatUpstreamToOrigin: truncate(input.remoteComparison.diffstatUpstreamToOrigin, 800),
          }
        : null,
    };
  }
}
