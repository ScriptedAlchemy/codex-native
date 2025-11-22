import { AgentRuntime, AgentTask, Model } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";

import type {
  AgentWorkflowConfig,
  CoordinatorInput,
  CoordinatorOutput,
  ReviewerOutput,
  WorkerInput,
  WorkerOutput,
} from "./types.js";
import type { WorkerOutcome } from "../merge/types.js";
import {
  buildCoordinatorPrompt,
  buildReviewerPrompt,
  buildWorkerPrompt,
} from "../merge/prompts.js";
import { DEFAULT_COORDINATOR_MODEL, DEFAULT_REVIEWER_MODEL, DEFAULT_WORKER_MODEL } from "../merge/constants.js";

/** Minimal orchestrator wiring agents via @openai/agents runtime. */
export class AgentWorkflowOrchestrator {
  private runtime: AgentRuntime;
  private coordinatorModel: Model;
  private workerModel: Model;
  private reviewerModel: Model;

  constructor(private readonly config: AgentWorkflowConfig) {
    this.runtime = new AgentRuntime({
      provider: new CodexProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      }),
    });

    this.coordinatorModel = (config.coordinatorModel as Model) ?? (DEFAULT_COORDINATOR_MODEL as Model);
    this.workerModel = (config.workerModel as Model) ?? (DEFAULT_WORKER_MODEL as Model);
    this.reviewerModel = (config.reviewerModel as Model) ?? (DEFAULT_REVIEWER_MODEL as Model);
  }

  async execute(input: CoordinatorInput): Promise<{
    success: boolean;
    outcomes: WorkerOutcome[];
    summary: string | null;
  }> {
    const coordinator = new AgentTask<CoordinatorInput, CoordinatorOutput>({
      name: "coordinator",
      model: this.coordinatorModel,
      instructions: buildCoordinatorPrompt(input),
    });

    const { output: coordinatorOutput } = await this.runtime.run(coordinator, input);
    const plan = coordinatorOutput?.plan ?? null;

    const outcomes: WorkerOutcome[] = [];

    for (const conflict of input.conflicts) {
      const workerTask = new AgentTask<WorkerInput, WorkerOutput>({
        name: `worker-${conflict.path}`,
        model: this.selectWorkerModel(conflict.path, conflict),
        instructions: buildWorkerPrompt(conflict, plan, {
          originRef: input.originRef,
          upstreamRef: input.upstreamRef,
        }),
      });

      const { output } = await this.runtime.run(workerTask, {
        conflict,
        coordinatorPlan: plan,
        remoteInfo: input.remoteComparison,
      });

      outcomes.push({
        path: conflict.path,
        success: output?.success ?? false,
        summary: output?.summary ?? undefined,
        error: output?.error,
        validationStatus: output?.validationStatus,
      });
    }

    const reviewerTask = new AgentTask<CoordinatorInput, ReviewerOutput>({
      name: "reviewer",
      model: this.reviewerModel,
      instructions: buildReviewerPrompt({
        status: input.statusShort,
        diffStat: input.diffStat,
        remaining: [],
        workerSummaries: outcomes,
        remoteComparison: input.remoteComparison ?? null,
        validationMode: false,
      }),
    });

    const { output: reviewerOutput } = await this.runtime.run(reviewerTask, input);

    const success = outcomes.every((o) => o.success);
    return {
      success,
      outcomes,
      summary: reviewerOutput?.summary ?? null,
    };
  }

  private selectWorkerModel(filePath: string, conflict: { lineCount: number | null; conflictMarkers: number | null }): Model {
    const severityScore = (conflict.lineCount ?? 0) + (conflict.conflictMarkers ?? 0) * 200;
    if (severityScore >= 800 && this.config.workerModelHigh) {
      return this.config.workerModelHigh as Model;
    }
    const matches = (patterns?: string[]) =>
      patterns?.some((pattern) => {
        try {
          return new RegExp(pattern).test(filePath);
        } catch {
          return false;
        }
      }) ?? false;

    if (matches(this.config.highReasoningMatchers) && this.config.workerModelHigh) {
      return this.config.workerModelHigh as Model;
    }
    if (matches(this.config.lowReasoningMatchers) && this.config.workerModelLow) {
      return this.config.workerModelLow as Model;
    }
    return (this.config.workerModel as Model) ?? (DEFAULT_WORKER_MODEL as Model);
  }
}
