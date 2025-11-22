/**
 * Coordinator Agent Definition
 *
 * Plans global merge strategy using @openai/agents SDK with CodexProvider
 */

import { Agent } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";
import { buildCoordinatorPrompt } from "../merge/prompts.js";
import { DEFAULT_COORDINATOR_MODEL } from "../merge/constants.js";
import type { AgentConfig, AgentFactory, CoordinatorInput } from "./types.js";

/**
 * Create a Coordinator Agent using the @openai/agents framework
 */
export function createCoordinatorAgent(
  config: AgentConfig & { model?: string }
): AgentFactory {
  const provider = new CodexProvider({
    defaultModel: config.model || DEFAULT_COORDINATOR_MODEL,
    workingDirectory: config.workingDirectory,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalMode,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    skipGitRepoCheck: config.skipGitRepoCheck ?? false,
  });

  const codexModel = provider.getModel(config.model || DEFAULT_COORDINATOR_MODEL);

  const coordinatorAgent = new Agent({
    name: "MergeCoordinator",
    model: codexModel,
    instructions: `You are the Merge Conflict Coordinator agent.

Responsibilities:
1. Analyze repository state (branch, commits, conflicts, remote divergence)
2. Create structured merge plan with sequencing and cross-file coupling analysis
3. Identify which conflicts need high-reasoning models vs simple resolution
4. Provide guidance to worker agents

Output a structured plan with:
- Executive summary
- Per-file strategy (what to preserve, what to integrate, complexity level)
- Cross-file couplings with reasoning
- Sequencing recommendations
- Post-resolution verification steps

Be concise and actionable.`,
  });

  return {
    agent: coordinatorAgent,
    model: codexModel,
  };
}

/**
 * Helper to format coordinator input as a prompt
 */
export function formatCoordinatorInput(input: CoordinatorInput): string {
  return buildCoordinatorPrompt(input);
}
