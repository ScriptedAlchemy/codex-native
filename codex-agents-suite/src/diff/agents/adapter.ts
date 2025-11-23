/**
 * Adapter utilities for agent workflow.
 */
import type { AgentWorkflowConfig } from "./types.js";
import type { SolverConfig } from "../merge/types.js";

export function convertToAgentConfig(config: SolverConfig): AgentWorkflowConfig {
  return {
    workingDirectory: config.workingDirectory,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalMode,
    skipGitRepoCheck: config.skipGitRepoCheck,
    coordinatorModel: config.coordinatorModel,
    workerModel: config.workerModel,
    reviewerModel: config.reviewerModel,
    supervisorModel: config.supervisorModel,
    workerModelHigh: config.workerModelHigh,
    workerModelLow: config.workerModelLow,
    highReasoningMatchers: config.highReasoningMatchers,
    lowReasoningMatchers: config.lowReasoningMatchers,
    maxConcurrentSimpleWorkers: config.maxConcurrentSimpleWorkers ?? 2,
    reasoningEffort: config.reasoningEffort,
    originRef: config.originRef,
    upstreamRef: config.upstreamRef,
    openCodeSeverityThreshold: config.openCodeSeverityThreshold,
    coordinatorInstructions: config.coordinatorInstructions,
    workerInstructions: config.workerInstructions,
    reviewerInstructions: config.reviewerInstructions,
    supervisorInstructions: config.supervisorInstructions,
  };
}
