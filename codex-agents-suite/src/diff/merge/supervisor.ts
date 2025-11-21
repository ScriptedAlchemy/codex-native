import type { Thread, ApprovalRequest } from "@codex-native/sdk";
import { Codex } from "@codex-native/sdk";

import { SUPERVISOR_OUTPUT_SCHEMA } from "./constants.js";
import { createThreadLogger, logInfo, logWarn } from "./logging.js";
import type { ThreadLoggingSink } from "../thread-logging.js";
import type { ApprovalContext, SupervisorDecision, SupervisorOptions, ThreadProvider } from "./types.js";
import { runThreadTurnWithLogs } from "../thread-logging.js";

export class ApprovalSupervisor {
  private readonly thread: Thread | null;
  private context: ApprovalContext | null = null;

  constructor(
    private readonly codex: Codex,
    private readonly options: SupervisorOptions,
    private readonly coordinatorThreadAccessor: ThreadProvider,
  ) {
    try {
      this.thread = this.codex.startThread({
        model: options.model,
        sandboxMode: options.sandboxMode,
        approvalMode: "never",
        workingDirectory: options.workingDirectory,
        skipGitRepoCheck: true,
      });
    } catch (error) {
      logWarn("supervisor", `Unable to start approval supervisor thread: ${error}`);
      this.thread = null;
    }
  }

  isAvailable(): boolean {
    return Boolean(this.thread);
  }

  setContext(context: ApprovalContext | null): void {
    this.context = context;
    if (context?.conflictPath) {
      logInfo("supervisor", "Monitoring worker", context.conflictPath);
    }
  }

  async handleApproval(request: ApprovalRequest): Promise<boolean> {
    if (!this.thread) {
      logWarn("supervisor", "Supervisor unavailable; auto-denying", request.type);
      return false;
    }
    const contextSummary = this.context
      ? `Conflict: ${this.context.conflictPath ?? "<unknown>"}\nPlan: ${
          this.context.coordinatorPlan?.slice(0, 2000) ?? "<none>"
        }\nRemote divergence: ${
          this.context.remoteInfo
            ? `${this.context.remoteInfo.originRef} ↔ ${this.context.remoteInfo.upstreamRef}`
            : "<not available>"
        }\nNotes: ${this.context.extraNotes ?? "<none>"}`
      : "No active worker context.";
    const detailsBlock =
      request.details !== undefined ? JSON.stringify(request.details, null, 2) : "<no additional details>";

    const prompt = `# Autonomous Approval Supervisor

You are a high-reasoning control agent responsible for approving or denying sensitive operations during a merge conflict remediation workflow. Only approve commands that are safe, necessary, and aligned with the plan. If a request is risky or redundant, deny it and explain the corrective guidance you want the worker to follow.

Context:
${contextSummary}

Approval request:
- Type: ${request.type}
- Details: ${detailsBlock}

Respond on the first line with either "APPROVE: <short reason>" or "DENY: <short reason>". You may follow up with bullet points containing corrective actions if denying.`;

    try {
      const turn = await runThreadTurnWithLogs(
        this.thread,
        createThreadLogger("supervisor", this.context?.conflictPath),
        prompt,
        { outputSchema: SUPERVISOR_OUTPUT_SCHEMA },
      );
      const parsedDecision = parseSupervisorDecision(turn.finalResponse);
      if (!parsedDecision) {
        logWarn("supervisor", "Produced non-JSON response; denying request", request.type);
        return false;
      }
      const approved = parsedDecision.decision === "approve";
      const summary =
        `${parsedDecision.decision.toUpperCase()}: ${parsedDecision.reason}` +
        (parsedDecision.corrective_actions?.length
          ? ` | Actions: ${parsedDecision.corrective_actions.join("; ")}`
          : "");
      if (!approved) {
        const coordinator = this.coordinatorThreadAccessor();
        if (coordinator) {
          const note =
            `Supervisor denied ${request.type}.\nReason: ${parsedDecision.reason}\n` +
            `Actions: ${parsedDecision.corrective_actions?.join("; ") ?? "(none)"}\nContext: ${contextSummary}`;
          await runThreadTurnWithLogs(coordinator, createThreadLogger("coordinator"), note);
        }
      }
      logInfo("supervisor", summary, request.type);
      return approved;
    } catch (error) {
      logWarn("supervisor", `Failed to respond; denying ${request.type}. ${error}`, request.type);
      return false;
    }
  }
}

export function parseSupervisorDecision(response: string): SupervisorDecision | null {
  if (!response) {
    return null;
  }
  try {
    const parsed = JSON.parse(response) as SupervisorDecision | { output?: SupervisorDecision };
    if (isDecision(parsed)) {
      return parsed;
    }
    if (parsed && typeof (parsed as any).output === "object" && isDecision((parsed as any).output)) {
      return (parsed as any).output;
    }
    return null;
  } catch {
    return null;
  }
}

function isDecision(value: unknown): value is SupervisorDecision {
  if (!value || typeof value !== "object") return false;
  const decision = (value as SupervisorDecision).decision;
  const reason = (value as SupervisorDecision).reason;
  return (
    (decision === "approve" || decision === "deny") &&
    typeof reason === "string" &&
    reason.trim().length > 0
  );
}
