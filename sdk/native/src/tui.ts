import { getNativeBinding } from "./nativeBinding";
import type {
  NativeTuiRequest,
  NativeTuiExitInfo,
  NativeTokenUsage,
  NativeUpdateActionInfo,
  NativeUpdateActionKind,
} from "./nativeBinding";

/**
 * Launches the Codex TUI (Terminal User Interface) with the specified configuration.
 *
 * This function starts a full-screen interactive terminal interface that allows you to
 * chat with the Codex agent. The TUI provides real-time streaming, tool execution
 * visualization, and interactive approval prompts.
 *
 * Uses the same TUI implementation as the standalone Rust `codex` CLI, ensuring
 * identical user experience and functionality.
 *
 * @param request - TUI configuration including:
 *                  - prompt: Optional initial prompt to start conversation
 *                  - model: Model to use (defaults to configured model)
 *                  - sandboxMode: Sandbox restriction level
 *                  - approvalMode: When to prompt for approvals
 *                  - resumeSessionId: Resume a specific session by ID
 *                  - resumeLast: Resume the most recent session
 *                  - resumePicker: Show session picker on startup
 *                  - workingDirectory: Directory to run in
 * @returns A Promise that resolves when the TUI exits, providing:
 *          - tokenUsage: Detailed token consumption statistics
 *          - conversationId: Session ID for resuming this conversation
 *          - updateAction: Optional suggested update command
 * @throws {Error} If the native TUI binding is not available
 * @throws {Error} If the terminal is not interactive (requires TTY)
 *
 * @example
 * ```typescript
 * import { runTui } from "@codex-native/sdk";
 *
 * const exitInfo = await runTui({
 *   prompt: "Review the latest git changes",
 *   sandboxMode: "workspace-write",
 *   approvalMode: "on-request"
 * });
 *
 * console.log("Session ID:", exitInfo.conversationId);
 * console.log("Tokens used:", exitInfo.tokenUsage.totalTokens);
 * ```
 *
 * @example
 * ```typescript
 * // Resume a previous session
 * await runTui({
 *   resumeSessionId: "session-abc-123"
 * });
 * ```
 */
export async function runTui(request: NativeTuiRequest): Promise<NativeTuiExitInfo> {
  const binding = getNativeBinding();
  if (!binding || typeof binding.runTui !== "function") {
    throw new Error("Native binding does not expose runTui");
  }
  return binding.runTui(request);
}

export type {
  NativeTuiRequest,
  NativeTuiExitInfo,
  NativeTokenUsage,
  NativeUpdateActionInfo,
  NativeUpdateActionKind,
};

