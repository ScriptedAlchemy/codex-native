/**
 * Reviewer Agent Definition
 *
 * Validates worker outcomes and produces a concise summary.
 */

import { Agent } from "@openai/agents";
import { CodexProvider } from "@codex-native/sdk";
import { buildReviewerPrompt } from "../merge/prompts.js";
import { DEFAULT_REVIEWER_MODEL } from "../merge/constants.js";
import type { AgentConfig, AgentFactory, ReviewerInput } from "./types.js";

export function createReviewerAgent(config: AgentConfig & { model?: string }): AgentFactory {
  const provider = new CodexProvider({
    defaultModel: config.model || DEFAULT_REVIEWER_MODEL,
    workingDirectory: config.workingDirectory,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalMode,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    skipGitRepoCheck: config.skipGitRepoCheck ?? false,
  });

  const model = provider.getModel(config.model || DEFAULT_REVIEWER_MODEL);

  const reviewer = new Agent({
    name: "MergeReviewer",
    model,
    instructions: "You review merge outcomes and produce a concise validation summary.",
  });

  return { agent: reviewer, model };
}

export function formatReviewerInput(input: ReviewerInput): string {
  return buildReviewerPrompt({
    status: input.outcomes.length ? "Merge validation" : "No conflicts",
    diffStat: "<omitted>",
    remaining: [],
    workerSummaries: input.outcomes,
    remoteComparison: input.remoteComparison,
    validationMode: false,
  });
}
