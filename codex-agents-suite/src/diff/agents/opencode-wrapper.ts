/**
 * OpenCode wrapper for complex conflicts.
 *
 * Uses the lower-level Codex thread API (outside @openai/agents) so we can run
 * high-reasoning tool executions with explicit approval supervision.
 */

import { Codex, type ApprovalMode, type SandboxMode, logger } from "@codex-native/sdk";
import { buildWorkerPrompt } from "../merge/prompts.js";
import type { ApprovalSupervisor } from "../merge/supervisor.js";
import type { ConflictContext, RemoteComparison, WorkerOutcome } from "../merge/types.js";

export interface OpenCodeOptions {
  workingDirectory: string;
  sandboxMode: SandboxMode;
  approvalSupervisor?: ApprovalSupervisor | null;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  coordinatorPlan?: string | null;
  remoteInfo?: RemoteComparison | null;
  approvalMode?: ApprovalMode;
}

export async function runOpenCodeResolution(
  conflict: ConflictContext,
  options: OpenCodeOptions,
): Promise<WorkerOutcome> {
  const codex = new Codex({
    baseUrl: options.baseUrl,
    apiKey: options.apiKey,
  });

  if (options.approvalSupervisor?.isAvailable()) {
    codex.setApprovalCallback(async (req) => options.approvalSupervisor!.handleApproval(req));
  }

  const thread = codex.startThread({
    model: options.model,
    sandboxMode: options.sandboxMode,
    approvalMode: options.approvalMode ?? "on-request",
    workingDirectory: options.workingDirectory,
    skipGitRepoCheck: true,
  });

  const prompt = buildWorkerPrompt(conflict, options.coordinatorPlan ?? null, {
    originRef: options.remoteInfo?.originRef,
    upstreamRef: options.remoteInfo?.upstreamRef,
  });

  try {
    const turn = await thread.run(prompt);
    const summary = turn.finalResponse ?? "";
    return {
      path: conflict.path,
      success: true,
      summary: summary || undefined,
      threadId: thread.id ?? undefined,
    };
  } catch (error: any) {
    logger.scope("opencode", conflict.path).warn(`OpenCode resolution failed: ${String(error)}`);
    return {
      path: conflict.path,
      success: false,
      error: error?.message ?? String(error),
      threadId: thread.id ?? undefined,
    };
  }
}
