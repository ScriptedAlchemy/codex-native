/**
 * Reviewer Agent Definition
 *
 * Validates worker outcomes and produces a concise summary.
 */

import { Agent } from "@openai/agents";
import { CodexProvider, type Codex } from "@codex-native/sdk";
import type { ApprovalSupervisor } from "../merge/supervisor.js";
import { buildReviewerPrompt } from "../merge/prompts.js";
import { DEFAULT_REVIEWER_MODEL } from "../merge/constants.js";
import type { AgentConfig, AgentFactory, ReviewerInput } from "./types.js";

export function createReviewerAgent(
  config: AgentConfig & {
    model?: string;
    approvalSupervisor?: ApprovalSupervisor | null;
    reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
  }
): AgentFactory {
  const provider = new CodexProvider({
    defaultModel: config.model || DEFAULT_REVIEWER_MODEL,
    workingDirectory: config.workingDirectory,
    sandboxMode: config.sandboxMode,
    approvalMode: config.approvalMode,
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    skipGitRepoCheck: config.skipGitRepoCheck ?? false,
    reasoningEffort: config.reasoningEffort ?? "high",
    enableLsp: true, // Enable LSP for reviewer to validate post-merge code quality
  });

  if (config.approvalSupervisor?.isAvailable?.()) {
    const codex = (provider as unknown as { getCodex?: () => Codex }).getCodex?.();
    codex?.setApprovalCallback((request) => config.approvalSupervisor!.handleApproval(request));
  }

  const model = provider.getModel(config.model || DEFAULT_REVIEWER_MODEL);

  const reviewer = new Agent({
    name: "MergeReviewer",
    model,
    instructions:
      config.reviewerInstructions ??
      `You review merge outcomes and produce a concise validation summary.

Important Review Criteria:
- Verify we aligned with UPSTREAM MAIN wherever possible
- Confirm our custom functionality remains operable and supported
- Check that changes are MINIMALLY INVASIVE
- Validate extension strategy:
  * Core functionality should be in sdk/native/src/
  * codex-rs changes should be minimal hooks/extension points only
  * No sprawling modifications to codex-rs internals
- Ensure all conflict markers are removed
- Assess functional correctness of the merge resolution`,
  });

  return { agent: reviewer, model };
}

export function formatReviewerInput(input: ReviewerInput): string {
  return buildReviewerPrompt({
    status: input.status,
    diffStat: input.diffStat,
    remaining: input.remaining,
    workerSummaries: input.outcomes,
    remoteComparison: input.remoteComparison,
    validationMode: input.validationMode ?? false,
    lspDiagnostics: input.lspDiagnostics,
  });
}
