import { run } from "@openai/agents";
import { Codex } from "@codex-native/sdk";
import type { AgentWorkflowConfig, CoordinatorInput } from "./types.js";
import type { WorkerOutcome, ConflictContext, RemoteComparison } from "../merge/types.js";
import { createCoordinatorAgent } from "./coordinator-agent.js";
import { createWorkerAgent, selectWorkerModel, formatWorkerInput } from "./worker-agent.js";
import { createReviewerAgent, formatReviewerInput } from "./reviewer-agent.js";
import { runOpenCodeResolution } from "./opencode-wrapper.js";
import { ApprovalSupervisor } from "../merge/supervisor.js";
import { GitRepo } from "../merge/git.js";
import { logInfo, logWarn } from "../merge/logging.js";

const OPEN_CODE_SEVERITY_THRESHOLD = 1200;

/**
 * Agent workflow orchestrator using @openai/agents SDK.
 * Drives: Coordinator → Worker(s) → Reviewer pipeline.
 */
export class AgentWorkflowOrchestrator {
  private readonly git = new GitRepo(this.config.workingDirectory);
  private readonly approvalSupervisor: ApprovalSupervisor | null;

  constructor(private readonly config: AgentWorkflowConfig) {
    this.approvalSupervisor = this.buildSupervisor();
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

    // Phase 2: Workers resolve individual conflicts
    const workerOutcomes = await this.runWorkerPhase(
      input.conflicts,
      coordinatorPlan,
      input.remoteComparison ?? null,
    );

    // Phase 3: Reviewer validates overall outcome
    const reviewerSummary = await this.runReviewerPhase(workerOutcomes, input.remoteComparison);

    const success = workerOutcomes.every((o) => o.success) && (await this.isAllResolved());
    const transcript = this.generateTranscript(coordinatorPlan, workerOutcomes, reviewerSummary);

    return {
      success,
      outcomes: workerOutcomes,
      coordinatorPlan,
      transcript,
    };
  }

  private async runCoordinatorPhase(input: CoordinatorInput): Promise<string | null> {
    logInfo("coordinator", "Running coordinator agent...");

    const { agent } = createCoordinatorAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.coordinatorModel,
    });

    const result = await run(agent, JSON.stringify(input));
    return result?.finalOutput ?? null;
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

    const schedule = (conflict: ConflictContext): void => {
      const task = this.handleConflict(conflict, coordinatorPlan, remoteComparison)
        .then((outcome) => outcomes.push(outcome))
        .finally(() => active.delete(task));
      active.add(task);
    };

    for (const conflict of simpleConflicts) {
      while (active.size >= maxConcurrent) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.race(active);
      }
      schedule(conflict);
    }

    if (active.size > 0) {
      await Promise.all(active);
    }

    for (const conflict of complexConflicts) {
      const outcome = await this.handleConflict(conflict, coordinatorPlan, remoteComparison, true);
      outcomes.push(outcome);
    }

    return outcomes;
  }

  private async runReviewerPhase(
    outcomes: WorkerOutcome[],
    remoteComparison: CoordinatorInput["remoteComparison"],
  ): Promise<string | null> {
    logInfo("reviewer", "Running reviewer agent...");

    const { agent } = createReviewerAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model: this.config.reviewerModel,
    });

    const reviewerPrompt = formatReviewerInput({ outcomes, remoteComparison: remoteComparison ?? null });
    const result = await run(agent, reviewerPrompt);

    return result?.finalOutput ?? null;
  }

  private computeSeverity(conflict: ConflictContext): number {
    const markers = conflict.conflictMarkers ?? 0;
    const lines = conflict.lineCount ?? 0;
    return markers * 10 + lines;
  }

  private isComplex(conflict: ConflictContext): boolean {
    return this.computeSeverity(conflict) >= OPEN_CODE_SEVERITY_THRESHOLD;
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
    });

    const { agent } = createWorkerAgent({
      workingDirectory: this.config.workingDirectory,
      baseUrl: this.config.baseUrl,
      apiKey: this.config.apiKey,
      sandboxMode: this.config.sandboxMode,
      approvalMode: this.config.approvalMode,
      skipGitRepoCheck: this.config.skipGitRepoCheck,
      model,
      conflictPath: conflict.path,
    });

    try {
      const workerPrompt = formatWorkerInput({ conflict, coordinatorPlan, remoteInfo: remoteComparison });
      const result = await run(agent, workerPrompt);

      const summary = result?.finalOutput ?? null;
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

  private buildSupervisor(): ApprovalSupervisor | null {
    const model = this.config.supervisorModel ?? this.config.coordinatorModel;
    if (!model) {
      return null;
    }
    try {
      const codex = new Codex({ baseUrl: this.config.baseUrl, apiKey: this.config.apiKey });
      const supervisor = new ApprovalSupervisor(
        codex,
        {
          model,
          workingDirectory: this.config.workingDirectory,
          sandboxMode: this.config.sandboxMode,
        },
        () => null,
      );
      if (!supervisor.isAvailable()) {
        return null;
      }
      return supervisor;
    } catch (error) {
      logWarn("supervisor", `Unable to initialize approval supervisor: ${error}`);
      return null;
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
}
