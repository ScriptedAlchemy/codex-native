/**
 * OpenCode wrapper with supervisory conversation support.
 *
 * The worker supervises OpenCode by:
 * 1. Delegating the conflict resolution task to OpenCode
 * 2. Monitoring OpenCode's progress and responses
 * 3. Providing feedback/guidance as needed
 * 4. Deciding when resolution is complete
 *
 * Uses the lower-level Codex thread API (outside @openai/agents) so we can run
 * high-reasoning tool executions with explicit approval supervision.
 */

import { Codex, type ApprovalMode, type SandboxMode, logger } from "@codex-native/sdk";
import { buildWorkerPrompt } from "../merge/prompts.js";
import { GitRepo } from "../merge/git.js";
import type { ApprovalSupervisor } from "../merge/supervisor.js";
import type { ConflictContext, RemoteComparison, WorkerOutcome } from "../merge/types.js";
import { logInfo } from "../merge/logging.js";

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
  supervisorPrompt?: string | null;
  maxSupervisionTurns?: number;
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

  const initialPrompt = buildWorkerPrompt(conflict, options.coordinatorPlan ?? null, {
    originRef: options.remoteInfo?.originRef,
    upstreamRef: options.remoteInfo?.upstreamRef,
  });

  const git = new GitRepo(options.workingDirectory);
  const conversationLog: string[] = [];
  const maxTurns = options.maxSupervisionTurns ?? 3;
  let turnCount = 0;

  try {
    // Turn 1: Initial task delegation to OpenCode
    logInfo("opencode", `Turn ${++turnCount}: Delegating conflict resolution...`, conflict.path);
    conversationLog.push(`[Supervisor → OpenCode] ${initialPrompt.slice(0, 200)}...`);

    let turn = await thread.run(initialPrompt);
    let response = turn.finalResponse ?? "";
    conversationLog.push(`[OpenCode → Supervisor] ${response.slice(0, 200)}...`);
    logInfo("opencode", `Turn ${turnCount} response: ${response.slice(0, 100)}...`, conflict.path);

    // Check if resolved
    let remaining = await git.listConflictPaths();
    let resolved = !remaining.includes(conflict.path);

    // Supervision loop: Continue if not resolved and within turn limit
    while (!resolved && turnCount < maxTurns) {
      logInfo("opencode", `Turn ${++turnCount}: Providing supervisor feedback...`, conflict.path);

      // Supervisor feedback based on current state
      const feedback = await buildSupervisorFeedback(conflict, response, remaining, options);
      conversationLog.push(`[Supervisor → OpenCode] ${feedback.slice(0, 200)}...`);

      turn = await thread.run(feedback);
      response = turn.finalResponse ?? "";
      conversationLog.push(`[OpenCode → Supervisor] ${response.slice(0, 200)}...`);
      logInfo("opencode", `Turn ${turnCount} response: ${response.slice(0, 100)}...`, conflict.path);

      remaining = await git.listConflictPaths();
      resolved = !remaining.includes(conflict.path);

      if (resolved) {
        logInfo("opencode", `Resolved after ${turnCount} supervision turns`, conflict.path);
        break;
      }
    }

    const conversationSummary = conversationLog.join("\n\n");

    return {
      path: conflict.path,
      success: resolved,
      summary: `${response}\n\n--- Supervision Conversation ---\n${conversationSummary}`,
      threadId: thread.id ?? undefined,
      error: resolved ? undefined : `Not resolved after ${turnCount} supervision turns`,
    };
  } catch (error: any) {
    logger.scope("worker", conflict.path).warn(`OpenCode supervision failed: ${String(error)}`);
    return {
      path: conflict.path,
      success: false,
      error: error?.message ?? String(error),
      threadId: thread.id ?? undefined,
    };
  }
}

async function buildSupervisorFeedback(
  conflict: ConflictContext,
  previousResponse: string,
  remainingConflicts: string[],
  options: OpenCodeOptions,
): Promise<string> {
  const git = new GitRepo(options.workingDirectory);

  // Check current state of the file
  const stillHasConflict = remainingConflicts.includes(conflict.path);

  if (stillHasConflict) {
    // Get current conflict markers count
    const content = await git.readWorkingFile(conflict.path);
    const markerCount = content ? (content.match(/^<<<<<<<|^=======|^>>>>>>>/gm) || []).length : 0;

    return `The conflict in ${conflict.path} still has ${markerCount} conflict markers remaining.

Previous attempt summary:
${previousResponse.slice(0, 500)}

Please review the file and resolve the remaining conflict markers. Remember:
- PREFER UPSTREAM: When in doubt, accept upstream main's changes
- MAINTAIN FUNCTIONALITY: Ensure our custom functionality remains operable
- Never leave conflict markers in the file

Please complete the resolution now.`;
  }

  return `Good progress on ${conflict.path}. Please verify the resolution is complete and functional.`;
}
