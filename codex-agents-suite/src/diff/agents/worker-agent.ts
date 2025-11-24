/**
 * Worker Agent Definition
 *
 * Handles individual conflict resolution with dynamic model selection
 */

import { Agent } from "@openai/agents";
import { CodexProvider, type Codex } from "@codex-native/sdk";
import type { ApprovalSupervisor } from "../merge/supervisor.js";
import { buildWorkerPrompt } from "../merge/prompts.js";
import { DEFAULT_WORKER_MODEL } from "../merge/constants.js";
import type { AgentConfig, AgentFactory, WorkerInput } from "./types.js";
import type { ConflictContext } from "../merge/types.js";

/**
 * Default matchers for high-reasoning model selection
 */
const DEFAULT_HIGH_REASONING_MATCHERS = [
  "**/app-server/**",
  "**/common/**",
  "**/*.rs",
  "**/src/core/**",
  "**/.github/workflows/**",
  // Config files are critical infrastructure - use high reasoning
  "**/*.toml",
  "**/Cargo.toml",
  "**/Cargo.lock",
  "**/*.yml",
  "**/*.yaml",
  "**/package.json",
  "**/pnpm-lock.yaml",
  "**/tsconfig.json",
];

/**
 * Default matchers for low-reasoning model selection
 */
const DEFAULT_LOW_REASONING_MATCHERS = [
  "**/*.md",
  "**/docs/**",
  "**/README*",
];

/**
 * Create worker agent
 */
export function createWorkerAgent(
  config: AgentConfig & {
    model?: string;
    conflictPath?: string;
    approvalSupervisor?: ApprovalSupervisor | null;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  }
): AgentFactory {
  const provider = new CodexProvider({
    defaultModel: config.model || DEFAULT_WORKER_MODEL,
    workingDirectory: config.workingDirectory,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalMode,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    skipGitRepoCheck: config.skipGitRepoCheck ?? false,
    reasoningEffort: config.reasoningEffort ?? "high",
    enableLsp: false, // Disable LSP during initial conflict resolution
  });

  if (config.approvalSupervisor?.isAvailable?.()) {
    const codex = (provider as unknown as { getCodex?: () => Codex }).getCodex?.();
    codex?.setApprovalCallback((request) => config.approvalSupervisor!.handleApproval(request));
  }

  const codexModel = provider.getModel(config.model || DEFAULT_WORKER_MODEL);

  const workerAgent = new Agent({
    name: config.conflictPath
      ? `MergeWorker[${config.conflictPath}]`
      : "MergeWorker",
    model: codexModel,
    instructions: config.workerInstructions ?? `You are a Merge Conflict Worker agent.

Responsibilities:
1. Resolve individual conflict files via three-way merge analysis
2. Execute file edits and commands
3. Provide structured outcomes

Important Principles:
- PREFER UPSTREAM: When in doubt, accept upstream main's changes - we want to stay aligned
- MAINTAIN FUNCTIONALITY: Ensure our custom functionality remains operable and supported
- MINIMALLY INVASIVE: Make the smallest changes necessary to preserve our features
- Extension Strategy:
  * Prefer implementing functionality in sdk/native/src/ (Rust/TypeScript)
  * codex-rs CAN be modified, but only for minimal hooks/extension points
  * Implement actual business logic in sdk/native that uses those hooks
  * Keep codex-rs changes small, clean, and easy to maintain across upstream merges
- If upstream modified core code we also changed, prefer their version and adapt our hooks
- Preserve upstream's code structure, patterns, and formatting

Output format:
- THREEWAY_SUMMARY: Brief analysis of what each side changed
- RESOLUTION_STRATEGY: Your approach (emphasize minimal invasiveness)
- COMMANDS_EXECUTED: List of commands run
- VALIDATION_PLAN: Tests/checks to run
- STATUS: RESOLVED | NEEDS_OPENCODE | FAILED

Never leave conflict markers in files.`,
  });

  return {
    agent: workerAgent,
    model: codexModel,
  };
}

/**
 * Helper to format worker input
 */
export function formatWorkerInput(input: WorkerInput): string {
  return buildWorkerPrompt(input.conflict, input.coordinatorPlan, {
    originRef: input.remoteInfo?.originRef,
    upstreamRef: input.remoteInfo?.upstreamRef,
  });
}

/**
 * Select reasoning effort based on file path and conflict severity
 */
export function selectReasoningEffort(
  conflict: ConflictContext,
  config: {
    defaultReasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
    highReasoningMatchers?: string[];
    lowReasoningMatchers?: string[];
  }
): "minimal" | "low" | "medium" | "high" | "xhigh" {
  const markerCount = conflict.conflictMarkers ?? 0;
  const lineCount = conflict.lineCount ?? 0;
  const severityScore = markerCount * 10 + lineCount;

  // Very high severity → xhigh reasoning
  if (severityScore > 1200) {
    return "xhigh";
  }

  // High severity → high reasoning
  if (severityScore > 800) {
    return "high";
  }

  const highMatchers =
    config.highReasoningMatchers && config.highReasoningMatchers.length > 0
      ? config.highReasoningMatchers
      : DEFAULT_HIGH_REASONING_MATCHERS;
  const lowMatchers =
    config.lowReasoningMatchers && config.lowReasoningMatchers.length > 0
      ? config.lowReasoningMatchers
      : DEFAULT_LOW_REASONING_MATCHERS;

  // Check file patterns
  const matchesHigh = highMatchers.some((pattern) => simpleGlobMatch(conflict.path, pattern));
  if (matchesHigh) {
    return "high";
  }

  const matchesLow = lowMatchers.some((pattern) => simpleGlobMatch(conflict.path, pattern));
  if (matchesLow) {
    return "low";
  }

  return config.defaultReasoningEffort ?? "medium";
}

/**
 * Select model based on file path and conflict severity
 */
export function selectWorkerModel(
  conflict: ConflictContext,
  config: {
    defaultModel: string;
    highReasoningModel?: string;
    lowReasoningModel?: string;
    highReasoningMatchers?: string[];
    lowReasoningMatchers?: string[];
  }
): string {
  const markerCount = conflict.conflictMarkers ?? 0;
  const lineCount = conflict.lineCount ?? 0;
  const severityScore = markerCount * 10 + lineCount;

  // High severity → high reasoning
  if (severityScore > 800) {
    return config.highReasoningModel || config.defaultModel;
  }

  const highMatchers =
    config.highReasoningMatchers && config.highReasoningMatchers.length > 0
      ? config.highReasoningMatchers
      : DEFAULT_HIGH_REASONING_MATCHERS;
  const lowMatchers =
    config.lowReasoningMatchers && config.lowReasoningMatchers.length > 0
      ? config.lowReasoningMatchers
      : DEFAULT_LOW_REASONING_MATCHERS;

  // Check file patterns
  const matchesHigh = highMatchers.some((pattern) => simpleGlobMatch(conflict.path, pattern));
  if (matchesHigh) {
    return config.highReasoningModel || config.defaultModel;
  }

  const matchesLow = lowMatchers.some((pattern) => simpleGlobMatch(conflict.path, pattern));
  if (matchesLow) {
    return config.lowReasoningModel || config.defaultModel;
  }

  return config.defaultModel;
}

function simpleGlobMatch(path: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" +
      pattern
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, ".*")
        .replace(/\*/g, "[^/]*") +
      "$"
  );
  return regex.test(path);
}
