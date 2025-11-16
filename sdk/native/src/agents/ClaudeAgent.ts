/**
 * ClaudeAgent - High-level agent for delegating work to Claude Code
 *
 * This class provides a simple interface for delegating tasks to Claude Code
 * using the internal APIs. It handles:
 * - Task delegation with automatic retries
 * - Conversation tracking and resumption
 * - Multi-turn workflows with feedback
 *
 * @example
 * ```typescript
 * const agent = new ClaudeAgent({
 *   model: 'claude-sonnet-4-5-20250929',
 *   workingDirectory: './workspace'
 * });
 *
 * // Delegate a task
 * const result = await agent.delegate('Create an add function');
 * console.log(result.output);
 *
 * // Resume with feedback
 * const update = await agent.resume(result.threadId, 'Add error handling');
 * ```
 */

import { Codex } from "../codex";
import type { RunResult } from "../thread";
import type { ThreadOptions, ApprovalMode, SandboxMode } from "../threadOptions";
import type { ThreadItem } from "../items";
import type { Usage } from "../events";

export interface ClaudeAgentOptions {
  /**
   * Model to use
   */
  model?: string;

  /**
   * Approval mode
   */
  approvalMode?: ApprovalMode;

  /**
   * Sandbox mode
   */
  sandboxMode?: SandboxMode;

  /**
   * Working directory for the agent
   */
  workingDirectory?: string;

  /**
   * Append custom instructions to the system prompt
   */
  appendSystemPrompt?: string;

  /**
   * Maximum number of retries on failure
   */
  maxRetries?: number;

  /**
   * Timeout in milliseconds
   */
  timeout?: number;
}

/**
 * Result from delegating a task to Claude Code
 *
 * This is Thread-compatible and can be used by other agents.
 */
export interface DelegationResult {
  /**
   * Thread ID for resuming the conversation
   */
  threadId?: string;

  /**
   * Final text response from Claude Code
   */
  output: string;

  /**
   * Whether the task succeeded
   */
  success: boolean;

  /**
   * Error message if any
   */
  error?: string;

  /**
   * Full items from the thread (includes tool calls, file changes, etc.)
   * This allows other agents to see what actions were taken
   */
  items?: ThreadItem[];

  /**
   * Token usage information
   */
  usage?: Usage | null;

  /**
   * The raw Thread RunResult for full compatibility
   * Use this to access all Thread-specific information
   */
  threadResult?: RunResult;
}

/**
 * ClaudeAgent provides a high-level interface for delegating work
 */
export class ClaudeAgent {
  private codex: Codex;
  private options: Required<Pick<ClaudeAgentOptions, "model" | "approvalMode" | "sandboxMode" | "maxRetries" | "timeout">>;
  private workingDirectory?: string;
  private appendSystemPrompt?: string;

  constructor(options: ClaudeAgentOptions = {}) {
    this.codex = new Codex();
    this.options = {
      model: options.model || "claude-sonnet-4-5-20250929",
      approvalMode: options.approvalMode || "on-request",
      sandboxMode: options.sandboxMode || "workspace-write",
      maxRetries: options.maxRetries || 1,
      timeout: options.timeout || 120000,
    };
    this.workingDirectory = options.workingDirectory;
    this.appendSystemPrompt = options.appendSystemPrompt;
  }

  /**
   * Delegate a task to Claude Code
   */
  async delegate(task: string): Promise<DelegationResult> {
    return this.executeTask(task);
  }

  /**
   * Resume a previous conversation with feedback
   */
  async resume(threadId: string, feedback: string): Promise<DelegationResult> {
    return this.executeTask(feedback, threadId);
  }

  /**
   * Execute a task with retry logic
   */
  private async executeTask(prompt: string, threadId?: string): Promise<DelegationResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        const threadOptions: ThreadOptions = {
          model: this.options.model,
          approvalMode: this.options.approvalMode,
          sandboxMode: this.options.sandboxMode,
        };

        if (this.workingDirectory) {
          threadOptions.workingDirectory = this.workingDirectory;
        }

        // Create or resume thread
        const thread = threadId
          ? this.codex.resumeThread(threadId, threadOptions)
          : this.codex.startThread(threadOptions);

        const result: RunResult = await thread.run(prompt);

        // Return Thread-compatible result with full information
        return {
          threadId: thread.id || undefined,
          output: result.finalResponse || "",
          success: true,
          items: result.items,
          usage: result.usage,
          threadResult: result,
        };
      } catch (error: any) {
        lastError = error;
        if (attempt < this.options.maxRetries) {
          // Wait before retry with exponential backoff
          await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    return {
      output: "",
      success: false,
      error: lastError?.message || "Unknown error",
    };
  }

  /**
   * Execute a multi-step workflow with automatic feedback
   */
  async workflow(steps: string[]): Promise<DelegationResult[]> {
    const results: DelegationResult[] = [];
    let threadId: string | undefined;

    for (const step of steps) {
      const result = threadId
        ? await this.resume(threadId, step)
        : await this.delegate(step);

      results.push(result);

      if (!result.success) {
        break; // Stop on first failure
      }

      threadId = result.threadId;
    }

    return results;
  }

  /**
   * Extract tool use items from a delegation result
   * Useful for seeing what commands/tools Claude executed
   */
  static getToolUses(result: DelegationResult): Array<{ name: string; input: any }> {
    if (!result.items) return [];

    return result.items
      .filter((item) => item.type === "command_execution" || item.type === "mcp_tool_call")
      .map((item: any) => ({
        name: item.command || item.tool_name || "unknown",
        input: item.input || item.arguments || {},
      }));
  }

  /**
   * Extract file changes from a delegation result
   * Useful for seeing what files Claude modified
   */
  static getFileChanges(result: DelegationResult): Array<{ path: string; status: string }> {
    if (!result.items) return [];

    return result.items
      .filter((item) => item.type === "file_change")
      .map((item: any) => ({
        path: item.path || "unknown",
        status: item.status || "modified",
      }));
  }

  /**
   * Get a summary of what actions were taken
   */
  static getSummary(result: DelegationResult): string {
    const toolUses = ClaudeAgent.getToolUses(result);
    const fileChanges = ClaudeAgent.getFileChanges(result);

    const parts: string[] = [result.output];

    if (toolUses.length > 0) {
      parts.push(
        `\nTools used: ${toolUses.map((t) => t.name).join(", ")}`
      );
    }

    if (fileChanges.length > 0) {
      parts.push(
        `\nFiles modified: ${fileChanges.map((f) => f.path).join(", ")}`
      );
    }

    if (result.usage) {
      const tokens = result.usage.input_tokens + result.usage.output_tokens;
      parts.push(`\nTokens: ${tokens}`);
    }

    return parts.join("");
  }
}
