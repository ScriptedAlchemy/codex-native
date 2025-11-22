import type { AgentWorkflowConfig, CoordinatorInput } from "./types.js";
import type { WorkerOutcome } from "../merge/types.js";
import { buildCoordinatorPrompt, buildReviewerPrompt } from "../merge/prompts.js";

/**
 * Placeholder orchestrator for agent-based workflow.
 * This scaffolds the intended agent execution without invoking the SDK yet.
 */
export class AgentWorkflowOrchestrator {
  constructor(private readonly config: AgentWorkflowConfig) {}

  async execute(input: CoordinatorInput): Promise<{
    success: boolean;
    outcomes: WorkerOutcome[];
    summary: string | null;
  }> {
    // Placeholder plan derived from coordinator prompt; real agent execution to follow.
    const plan = buildCoordinatorPrompt(input);

    const outcomes: WorkerOutcome[] = input.conflicts.map((conflict) => ({
      path: conflict.path,
      success: false,
      summary: "Agent workflow placeholder: resolution not yet executed",
      error: "Agent execution not yet implemented",
    }));

    const reviewSummary = buildReviewerPrompt({
      status: input.statusShort,
      diffStat: input.diffStat,
      remaining: input.conflicts.map((c) => c.path),
      workerSummaries: outcomes,
      remoteComparison: input.remoteComparison ?? null,
      validationMode: false,
    });

    const success = outcomes.every((o) => o.success);
    return {
      success,
      outcomes,
      summary: reviewSummary,
    };
  }
}
