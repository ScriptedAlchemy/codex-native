/**
 * Dual-Agent Merge Resolution
 *
 * Architecture (based on sdk/native/examples/dual-agent-with-approvals.ts):
 * - Supervisor (GPT Codex): Smart model that analyzes conflicts and creates strategic plans
 * - OpenCode Agent: Cheap model that executes file edits and requests supervisor approval
 * - Approval Flow: OpenCode requests actions → Supervisor approves/denies → OpenCode proceeds
 *
 * The supervisor provides high-level strategic guidance while OpenCode does the actual work.
 * This is cost-effective: smart model for analysis, cheap model for execution.
 */

import { CodexProvider, OpenCodeAgent, Codex, type ApprovalMode, type SandboxMode, type PermissionRequest } from "@codex-native/sdk";
import { Agent, Runner } from "@openai/agents";
import { buildWorkerPrompt } from "../merge/prompts.js";
import { GitRepo } from "../merge/git.js";
import type { ApprovalSupervisor } from "../merge/supervisor.js";
import type { ConflictContext, RemoteComparison, WorkerOutcome } from "../merge/types.js";
import { logInfo, logWarn } from "../merge/logging.js";

export interface OpenCodeOptions {
  workingDirectory: string;
  sandboxMode: SandboxMode;
  approvalSupervisor?: ApprovalSupervisor | null;
  supervisorModel: string; // Smart model for supervisor (e.g., gpt-5.1-codex-max)
  openCodeModel: string;   // Cheap model for OpenCode worker (e.g., claude-sonnet-4-5)
  baseUrl?: string;
  apiKey?: string;
  coordinatorPlan?: string | null;
  remoteInfo?: RemoteComparison | null;
  approvalMode?: ApprovalMode;
  maxSupervisionTurns?: number;
}

/**
 * Supervisor agent that creates strategic plans and approves OpenCode's actions
 */
class MergeSupervisorAgent {
  private runner: Runner;
  private agent: Agent;
  private plan: string = "";

  constructor(
    codexProvider: CodexProvider,
    private conflict: ConflictContext,
    coordinatorPlan: string | null,
    remoteInfo: { originRef?: string | null; upstreamRef?: string | null } | null,
  ) {
    this.runner = new Runner({ modelProvider: codexProvider });

    this.agent = new Agent({
      name: `MergeSupervisor[${conflict.path}]`,
      model: codexProvider.getModel(codexProvider.options.defaultModel || "gpt-5.1-codex-max"),
      instructions: `You are an intelligent merge conflict supervisor for ${conflict.path}.

Your role:
1. Analyze the three-way merge conflict
2. Create strategic resolution plan
3. Approve/deny OpenCode's file operations to ensure they align with the plan
4. Verify conflict resolution quality

When creating plans:
- PREFER UPSTREAM: Accept upstream main's changes when in doubt
- MAINTAIN FUNCTIONALITY: Ensure custom functionality remains operable
- MINIMALLY INVASIVE: Make smallest changes necessary

When reviewing approval requests:
- Check if action aligns with strategic plan
- Evaluate safety (avoid destructive operations)
- Consider merge context and intent
- Provide clear reasoning

Safe actions to APPROVE:
- Reading files (read_file, git show, git diff)
- Analyzing code (grep, ls, find)
- Writing resolved conflict files
- Running validation (rg '<<<<<<<' to check markers)
- Test execution

Actions requiring review:
- Deleting files
- Modifying files outside conflict scope
- Running builds (heavy operations)

Response format for approvals:
{
  "decision": "APPROVE" | "DENY",
  "reason": "Clear explanation"
}`,
      // No outputType by default - will output plain text for plans
      // Only switch to JSON schema temporarily for approval reviews
    });
  }

  async createPlan(coordinatorPlan: string | null, remoteInfo: { originRef?: string | null; upstreamRef?: string | null } | null): Promise<string> {
    logInfo("supervisor", "Analyzing conflict and creating strategic plan...", this.conflict.path);

    const prompt = buildWorkerPrompt(this.conflict, coordinatorPlan, {
      originRef: remoteInfo?.originRef,
      upstreamRef: remoteInfo?.upstreamRef,
    });

    logInfo("conversation", `\n${"=".repeat(80)}\n[Supervisor Analysis]\n${prompt}\n${"=".repeat(80)}`, this.conflict.path);

    const result = await this.runner.run(this.agent, prompt);
    this.plan = result.finalOutput as string;

    logInfo("conversation", `\n${"=".repeat(80)}\n[Supervisor Plan]\n${this.plan}\n${"=".repeat(80)}`, this.conflict.path);

    return this.plan;
  }

  async reviewApproval(request: PermissionRequest): Promise<boolean> {
    logInfo("approval", `\n📋 Approval Request: ${request.type} - ${request.title}`, this.conflict.path);

    const prompt = `Review this approval request from OpenCode:

TYPE: ${request.type}
TITLE: ${request.title}
DETAILS: ${JSON.stringify(request.details, null, 2)}

CURRENT PLAN:
${this.plan || "No plan available"}

CONFLICT FILE: ${this.conflict.path}

Should this action be approved? Consider:
1. Does it align with the strategic plan?
2. Is it safe and necessary?
3. Does it help resolve the conflict?

Respond with your decision.`;

    try {
      // Temporarily switch agent to approval output schema
      const originalOutputType = this.agent.outputType;
      this.agent.outputType = {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            decision: { type: "string", enum: ["APPROVE", "DENY"] },
            reason: { type: "string" },
          },
          required: ["decision", "reason"],
          additionalProperties: false,
        },
        name: "ApprovalDecision",
        strict: true,
      };

      const result = await this.runner.run(this.agent, prompt);
      const decision = result.finalOutput as any;

      // Restore original output type
      this.agent.outputType = originalOutputType;

      if (decision.decision === "APPROVE") {
        logInfo("approval", `✅ APPROVED: ${decision.reason}`, this.conflict.path);
        return true;
      } else {
        logWarn("approval", `❌ DENIED: ${decision.reason}`, this.conflict.path);
        return false;
      }
    } catch (error: any) {
      logWarn("approval", `❌ ERROR: ${error.message} - Denying by default`, this.conflict.path);
      return false; // Fail closed
    }
  }
}

export async function runOpenCodeResolution(
  conflict: ConflictContext,
  options: OpenCodeOptions,
): Promise<WorkerOutcome> {
  const git = new GitRepo(options.workingDirectory);
  const conversationLog: string[] = [];
  let opencodeAgent: OpenCodeAgent | null = null;

  try {
    // Phase 1: Create supervisor (smart model)
    logInfo("supervisor", "Initializing dual-agent workflow...", conflict.path);

    const codexProvider = new CodexProvider({
      defaultModel: options.supervisorModel,
      workingDirectory: options.workingDirectory,
      skipGitRepoCheck: true,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
    });
    if (options.approvalSupervisor?.isAvailable()) {
      codexProvider.setApprovalCallback((req) => options.approvalSupervisor!.handleApproval(req));
    }

    const supervisor = new MergeSupervisorAgent(
      codexProvider,
      conflict,
      options.coordinatorPlan ?? null,
      {
        originRef: options.remoteInfo?.originRef,
        upstreamRef: options.remoteInfo?.upstreamRef,
      },
    );

    // Phase 2: Supervisor creates strategic plan
    const plan = await supervisor.createPlan(options.coordinatorPlan ?? null, {
      originRef: options.remoteInfo?.originRef,
      upstreamRef: options.remoteInfo?.upstreamRef,
    });

    conversationLog.push(`[Supervisor Plan] ${plan.slice(0, 200)}...`);

    // Phase 3: Create OpenCode agent (cheap model) with approval callback
    logInfo("opencode", "Creating OpenCode execution agent...", conflict.path);

    const approvalHandler = async (request: PermissionRequest): Promise<boolean> => {
      return await supervisor.reviewApproval(request);
    };

    opencodeAgent = new OpenCodeAgent({
      model: options.openCodeModel,
      onApprovalRequest: approvalHandler,
      config: {
        workingDirectory: options.workingDirectory,
        sandboxMode: options.sandboxMode,
        approvalMode: options.approvalMode ?? "on-request",
      },
    });

    // Phase 4: OpenCode executes plan
    const executionPrompt = `Execute this merge conflict resolution plan:

${plan}

File to resolve: ${conflict.path}

Requirements:
1. Follow the strategic plan exactly
2. Remove all conflict markers
3. Verify with: rg '<<<<<<<' ${conflict.path}
4. Report completion status`;

    logInfo("conversation", `\n${"=".repeat(80)}\n[Supervisor → OpenCode]\n${executionPrompt}\n${"=".repeat(80)}`, conflict.path);
    conversationLog.push(`[Supervisor → OpenCode] ${executionPrompt.slice(0, 200)}...`);

    logInfo("opencode", "OpenCode executing plan...", conflict.path);

    // Execute with streaming to show progress
    const result = await opencodeAgent.delegateStreaming(executionPrompt, (event) => {
      // Log interesting events
      const props = (event as any)?.properties ?? {};
      if (event.type === "message.part.updated") {
        const part = props.info as { type: string; text?: string };
        if (part?.type === "text" && part.text) {
          logInfo("opencode", `Response: ${part.text.trim().slice(0, 100)}...`, conflict.path);
        }
      } else if (event.type === "command.executed") {
        const command = props as { name?: string; arguments?: string };
        const summary = [command.name, command.arguments].filter(Boolean).join(" ");
        logInfo("opencode", `Executed: ${summary}`, conflict.path);
      }
    });

    const response = result.output || "(no response)";
    conversationLog.push(`[OpenCode → Supervisor] ${response.slice(0, 200)}...`);
    logInfo("conversation", `\n${"=".repeat(80)}\n[OpenCode → Supervisor]\n${response}\n${"=".repeat(80)}`, conflict.path);

    // Phase 5: Verify resolution by checking file content for conflict markers
    // Note: Git index status (UU) remains until staged, so we check actual content instead
    let resolved = false;
    try {
      const { execFile } = await import("node:child_process");
      const { access } = await import("node:fs/promises");
      const { promisify } = await import("node:util");
      const { resolve } = await import("node:path");
      const execFileAsync = promisify(execFile);

      // Check if file exists (handles modify/delete conflicts)
      const fullPath = resolve(options.workingDirectory, conflict.path);
      try {
        await access(fullPath);
      } catch {
        // File doesn't exist - might be a delete/modify conflict
        logInfo("opencode", `⚠️  File does not exist (may be modify/delete conflict) - checking git status`, conflict.path);
        // For modify/delete conflicts, we consider them resolved if OpenCode handled them
        // The actual resolution (accepting delete or keeping modify) will be staged by git
        resolved = result.success;
        return {
          path: conflict.path,
          success: resolved,
          summary: `${response}\n\n--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
          error: resolved ? undefined : "File does not exist - modify/delete conflict not handled",
        };
      }

      // Check for conflict markers in the actual file content
      const { stdout } = await execFileAsync("rg", ["-e", "<<<<<<<", "-e", "=======", "-e", ">>>>>>>", conflict.path], {
        cwd: options.workingDirectory,
      });

      // If rg found markers, file is not resolved
      resolved = false;
      logWarn("opencode", `⚠️  Conflict markers still present in file content`, conflict.path);
    } catch (error: any) {
      // rg exits with code 1 when no matches found - this means file is resolved
      if (error.code === 1) {
        resolved = true;
        logInfo("opencode", "✅ Conflict markers removed from file content!", conflict.path);
      } else {
        // Some other error
        logWarn("opencode", `⚠️  Error checking for conflict markers: ${error.message}`, conflict.path);
        resolved = false;
      }
    }

    if (!result.success) {
      logWarn("opencode", `Execution failed: ${result.error}`, conflict.path);
      return {
        path: conflict.path,
        success: false,
        error: result.error || "OpenCode execution failed",
        summary: `${response}\n\n--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
      };
    }

    // Phase 6: Fallback to supervisor if OpenCode failed to resolve
    if (!resolved) {
      logWarn("opencode", `OpenCode failed to resolve conflict - falling back to supervisor agent`, conflict.path);
      conversationLog.push(`[Fallback] OpenCode failed - Supervisor taking over`);

      const supervisorCodex = new Codex({
        defaultModel: options.supervisorModel,
        workingDirectory: options.workingDirectory,
        sandboxMode: options.sandboxMode,
        approvalMode: "never", // Supervisor resolves without approvals
      });

      try {
        const fallbackPrompt = `The OpenCode agent failed to resolve this merge conflict. You are the supervisor agent taking over.

${plan}

File to resolve: ${conflict.path}

OpenCode's attempt:
${response}

Requirements:
1. Analyze why OpenCode failed
2. Resolve the conflict yourself using Edit or Write tools
3. Remove all conflict markers
4. Verify with: rg '<<<<<<<' ${conflict.path}
5. Report what you did differently`;

        logInfo("supervisor", "Supervisor attempting direct resolution...", conflict.path);
        logInfo("conversation", `\n${"=".repeat(80)}\n[Supervisor Fallback]\n${fallbackPrompt}\n${"=".repeat(80)}`, conflict.path);
        conversationLog.push(`[Supervisor Fallback] ${fallbackPrompt.slice(0, 200)}...`);

        const fallbackThread = supervisorCodex.startThread();
        const fallbackTurn = await fallbackThread.run(fallbackPrompt);
        const fallbackOutput = fallbackTurn.output || "(no response)";

        conversationLog.push(`[Supervisor Result] ${fallbackOutput.slice(0, 200)}...`);
        logInfo("conversation", `\n${"=".repeat(80)}\n[Supervisor Result]\n${fallbackOutput}\n${"=".repeat(80)}`, conflict.path);

        if (fallbackTurn.error) {
          logWarn("supervisor", `Supervisor also failed: ${fallbackTurn.error.message}`, conflict.path);
          return {
            path: conflict.path,
            success: false,
            error: `Both OpenCode and supervisor failed. OpenCode: ${result.error || "unknown"}. Supervisor: ${fallbackTurn.error.message}`,
            summary: `--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
          };
        }

        // Re-verify after supervisor's attempt
        try {
          const { execFile } = await import("node:child_process");
          const { promisify } = await import("node:util");
          const execFileAsync = promisify(execFile);

          await execFileAsync("rg", ["-e", "<<<<<<<", "-e", "=======", "-e", ">>>>>>>", conflict.path], {
            cwd: options.workingDirectory,
          });

          // If we get here, markers still exist
          logWarn("supervisor", `Supervisor failed - conflict markers still present`, conflict.path);
          resolved = false;
        } catch (error: any) {
          if (error.code === 1) {
            // Success - no markers found
            logInfo("supervisor", "✅ Supervisor successfully resolved the conflict!", conflict.path);
            resolved = true;
          } else {
            logWarn("supervisor", `Error re-verifying: ${error.message}`, conflict.path);
            resolved = false;
          }
        }

        return {
          path: conflict.path,
          success: resolved,
          summary: `${fallbackOutput}\n\n--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
          error: resolved ? undefined : "Supervisor attempted resolution but conflict markers still present",
        };
      } catch (error: any) {
        logWarn("supervisor", `Supervisor fallback failed: ${error.message}`, conflict.path);
        return {
          path: conflict.path,
          success: false,
          error: `OpenCode failed and supervisor fallback errored: ${error.message}`,
          summary: `--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
        };
      }
    }

    return {
      path: conflict.path,
      success: resolved,
      summary: `${response}\n\n--- Dual-Agent Conversation ---\n${conversationLog.join("\n\n")}`,
      error: resolved ? undefined : "Conflict markers still present",
    };
  } catch (error: any) {
    logWarn("supervisor", `Dual-agent workflow failed: ${error.message}`, conflict.path);
    return {
      path: conflict.path,
      success: false,
      error: error?.message ?? String(error),
      summary: conversationLog.length > 0 ? `--- Conversation Log ---\n${conversationLog.join("\n\n")}` : undefined,
    };
  } finally {
    // Cleanup: Shut down OpenCode server to prevent zombie processes
    if (opencodeAgent) {
      try {
        await opencodeAgent.close();
        logInfo("opencode", "OpenCode server shut down successfully", conflict.path);
      } catch (error: any) {
        logWarn("opencode", `Failed to shut down OpenCode server: ${error.message}`, conflict.path);
      }
    }
  }
}
