/**
 * Supervisor Agent Definition
 *
 * Provides approval/denial guidance for sensitive operations. Intended to be
 * forked from the coordinator thread to inherit merge context.
 */

import { Agent } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";
import { DEFAULT_COORDINATOR_MODEL } from "../merge/constants.js";
import type { AgentConfig, AgentFactory } from "./types.js";

export function createSupervisorAgent(
  config: AgentConfig & { model?: string; coordinatorPlan?: string }
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

  const model = provider.getModel(config.model || DEFAULT_COORDINATOR_MODEL);

  const supervisor = new Agent({
    name: "MergeSupervisor",
    model,
    instructions: `You are an approval supervisor for merge conflict resolution.
You see the coordinator's plan and approve/deny sensitive operations (file writes, commands).
If denying, provide short corrective actions.

Plan (may be empty):
${config.coordinatorPlan ?? "<not provided>"}

Respond concisely with APPROVE or DENY and a one-line reason.`,
  });

  return { agent: supervisor, model };
}
