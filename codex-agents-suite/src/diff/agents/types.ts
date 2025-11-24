/**
 * Shared types for agent-based merge solver workflow.
 */
import type { ApprovalMode, SandboxMode } from "@codex-native/sdk";
import type { Agent, Model } from "@openai/agents";
import type {
  ConflictContext,
  RemoteComparison,
  WorkerOutcome,
  SolverConfig,
  RepoSnapshot,
} from "../merge/types.js";

export interface AgentConfig {
  workingDirectory: string;
  baseUrl?: string;
  apiKey?: string;
  sandboxMode: SandboxMode;
  skipGitRepoCheck?: boolean;
  approvalMode?: ApprovalMode;
  coordinatorInstructions?: string;
  workerInstructions?: string;
  reviewerInstructions?: string;
  supervisorInstructions?: string;
}

export interface AgentModelConfig {
  coordinatorModel: string;
  workerModel: string;
  reviewerModel: string;
  supervisorModel?: string;
  workerModelHigh?: string;
  workerModelLow?: string;
  highReasoningMatchers?: string[];
  lowReasoningMatchers?: string[];
}

export interface CoordinatorInput extends RepoSnapshot {
  originRef?: string | null;
  upstreamRef?: string | null;
}

export interface CoordinatorOutput {
  plan: string | null;
  summary?: string | null;
}

export interface WorkerInput {
  conflict: ConflictContext;
  coordinatorPlan: string | null;
  remoteInfo?: RemoteComparison | null;
}

export interface WorkerOutput extends WorkerOutcome {
  transcript?: string;
}

export interface ReviewerInput {
  outcomes: WorkerOutcome[];
  remoteComparison: RemoteComparison | null;
  status: string;
  diffStat: string;
  remaining: string[];
  validationMode?: boolean;
  lspDiagnostics?: string | null;
}

export interface ReviewerOutput {
  summary: string | null;
}

export interface AgentFactory {
  agent: Agent;
  model: Model;
}

export type CoordinatorAgentFactory = AgentFactory;
export type WorkerAgentFactory = AgentFactory;
export type SupervisorAgentFactory = AgentFactory;
export type ReviewerAgentFactory = AgentFactory;

export interface AgentWorkflowConfig extends AgentConfig, AgentModelConfig {
  maxConcurrentSimpleWorkers: number;
  reasoningEffort?: SolverConfig["reasoningEffort"];
  /**
   * Optional stub mode for tests/offline runs. When true, the orchestrator
   * returns simulated outcomes without invoking remote models.
   */
  dryRun?: boolean;
  originRef?: string | null;
  upstreamRef?: string | null;
  openCodeSeverityThreshold?: number;
}
