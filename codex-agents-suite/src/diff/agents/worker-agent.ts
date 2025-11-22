/**
 * Worker Agent Definition
 *
 * Handles individual conflict resolution with dynamic model selection
 */

import { Agent } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";
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
];

/**
 * Default matchers for low-reasoning model selection
 */
const DEFAULT_LOW_REASONING_MATCHERS = [
  "**/*.md",
  "**/docs/**",
  "**/.github/workflows/**",
  "**/README*",
];

/**
 * Create worker agent
 */
export function createWorkerAgent(
  config: AgentConfig & { model?: string; conflictPath?: string }
): AgentFactory {
  const provider = new CodexProvider({
    defaultModel: config.model || DEFAULT_WORKER_MODEL,
    workingDirectory: config.workingDirectory,
    sandboxMode: config.sandboxMode,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    skipGitRepoCheck: config.skipGitRepoCheck ?? false,
  });

  const codexModel = provider.getModel(config.model || DEFAULT_WORKER_MODEL);

  const workerAgent = new Agent({
    name: config.conflictPath
      ? `MergeWorker[${config.conflictPath}]`
      : "MergeWorker",
    model: codexModel,
    instructions: `You are a Merge Conflict Worker agent.

Responsibilities:
1. Resolve individual conflict files via three-way merge analysis
2. Execute file edits and commands
3. Provide structured outcomes

Output format:
- THREEWAY_SUMMARY: Brief analysis of what each side changed
- RESOLUTION_STRATEGY: Your approach
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
 * Select model based on file path and conflict severity
 */
export function selectWorkerModel(
  conflict: ConflictContext,
  config: {
    defaultModel: string;
    highReasoningModel?: string;
    lowReasoningModel?: string;
  }
): string {
  const markerCount = conflict.conflictMarkers ?? 0;
  const lineCount = conflict.lineCount ?? 0;
  const severityScore = markerCount * 10 + lineCount;

  // High severity → high reasoning
  if (severityScore > 800) {
    return config.highReasoningModel || config.defaultModel;
  }

  // Check file patterns
  const matchesHigh = DEFAULT_HIGH_REASONING_MATCHERS.some((pattern) =>
    simpleGlobMatch(conflict.path, pattern)
  );
  if (matchesHigh) {
    return config.highReasoningModel || config.defaultModel;
  }

  const matchesLow = DEFAULT_LOW_REASONING_MATCHERS.some((pattern) =>
    simpleGlobMatch(conflict.path, pattern)
  );
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
