/**
 * ClaudeAgent - High-level agent wrapper with approval callback support
 *
 * This class provides a simple interface for delegating tasks with built-in
 * approval callback support. It wraps the Thread API to provide:
 * - Task delegation with automatic retries
 * - Conversation tracking and resumption
 * - Multi-turn workflows with feedback
 * - Intelligent approval handling via callbacks
 *
 * @example
 * ```typescript
 * const agent = new ClaudeAgent({
 *   model: 'gpt-5-codex',
 *   workingDirectory: './workspace',
 *   onApprovalRequest: async (request) => {
 *     console.log(`Approval needed for ${request.type}`);
 *     // Use AI or custom logic to decide
 *     return true; // approve
 *   }
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
import type { ApprovalRequest } from "../nativeBinding";

export interface ClaudeAgentOptions {
  /**
   * Model to use (e.g., 'gpt-5-codex', 'gpt-5.1-codex')
   * Note: ClaudeAgent uses Codex backend which supports GPT models
   */
  model?: string;

  /**
   * Approval mode
   * - 'on-request': Ask for approval when needed (default)
   * - 'never': Auto-approve everything (dangerous)
   * - 'on-failure': Only ask if a command fails
   * - 'unless-trusted': Ask unless command is trusted
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

  /**
   * Callback to handle approval requests from the agent.
   * Return true to approve, false to deny.
   *
   * The callback receives an ApprovalRequest with:
   * - type: "shell" | "file_write" | "network_access"
   * - details: object with request-specific information
   *
   * @example
   * ```typescript
   * onApprovalRequest: async (request) => {
   *   if (request.type === 'shell') {
   *     console.log(`Command: ${request.details.command}`);
   *     // Use AI to decide
   *     return await aiApprover.review(request);
   *   }
   *   return true; // auto-approve other types
   * }
   * ```
   */
  onApprovalRequest?: (request: ApprovalRequest) => boolean | Promise<boolean>;
}

/**
 * Result from delegating a task
 */
export interface DelegationResult {
  /**
   * Thread ID for resuming the conversation
   */
  threadId?: string;

  /**
   * Final text response
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
   */
  items?: ThreadItem[];

  /**
   * Token usage information
   */
  usage?: Usage | null;

  /**
   * The raw Thread RunResult for full compatibility
   */
  threadResult?: RunResult;
}

/**
 * ClaudeAgent provides a high-level interface for task delegation with approval support
 */
export class ClaudeAgent {
  private codex: Codex;
  private options: Required<Pick<ClaudeAgentOptions, "model" | "approvalMode" | "sandboxMode" | "maxRetries" | "timeout">>;
  private workingDirectory?: string;
  private appendSystemPrompt?: string;
  private approvalHandler?: (request: ApprovalRequest) => boolean | Promise<boolean>;

  constructor(options: ClaudeAgentOptions = {}) {
    this.codex = new Codex();
    this.options = {
      model: options.model || "gpt-5-codex",
      approvalMode: options.approvalMode || "on-request",
      sandboxMode: options.sandboxMode || "workspace-write",
      maxRetries: options.maxRetries || 1,
      timeout: options.timeout || 120000,
    };
    this.workingDirectory = options.workingDirectory;
    this.appendSystemPrompt = options.appendSystemPrompt;
    this.approvalHandler = options.onApprovalRequest;
  }

  /**
   * Delegate a task to the agent
   *
   * @param task - The task description or prompt
   * @returns Promise resolving to the delegation result
   *
   * @example
   * ```typescript
   * const result = await agent.delegate('Create a test file');
   * if (result.success) {
   *   console.log(result.output);
   * }
   * ```
   */
  async delegate(task: string): Promise<DelegationResult> {
    return this.executeTask(task);
  }

  /**
   * Resume a previous conversation with feedback
   *
   * @param threadId - The thread ID from a previous delegation
   * @param feedback - Additional feedback or instructions
   * @returns Promise resolving to the delegation result
   *
   * @example
   * ```typescript
   * const update = await agent.resume(result.threadId, 'Add error handling');
   * ```
   */
  async resume(threadId: string, feedback: string): Promise<DelegationResult> {
    return this.executeTask(feedback, threadId);
  }

  /**
   * Delegate a task with streaming output
   *
   * @param task - The task description or prompt
   * @param onEvent - Optional callback for streaming events
   * @returns Promise resolving to the delegation result
   *
   * @example
   * ```typescript
   * const result = await agent.delegateStreaming('Create a test file', (event) => {
   *   if (event.type === 'output_text_delta') {
   *     process.stdout.write(event.delta);
   *   }
   * });
   * ```
   */
  async delegateStreaming(
    task: string,
    onEvent?: (event: any) => void,
    threadId?: string
  ): Promise<DelegationResult> {
    return this.executeTaskStreaming(task, onEvent, threadId);
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

        // Register approval handler if provided
        if (this.approvalHandler) {
          thread.onApprovalRequest(this.approvalHandler);
        }

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
   * Execute a task with streaming and retry logic
   */
  private async executeTaskStreaming(
    prompt: string,
    onEvent?: (event: any) => void,
    threadId?: string
  ): Promise<DelegationResult> {
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

        // Register approval handler if provided
        if (this.approvalHandler) {
          thread.onApprovalRequest(this.approvalHandler);
        }

        const { events } = await thread.runStreamed(prompt);

        let finalResponse = "";
        const items: any[] = [];
        let usage: any = null;

        // Stream events to callback and collect final result
        for await (const event of events) {
          if (onEvent) {
            onEvent(event);
          }

          // Collect items as they complete
          if (event.type === "item.completed") {
            items.push(event.item);
            if (event.item.type === "agent_message") {
              finalResponse = event.item.text || "";
            }
          }

          // Collect usage from turn.completed event
          if (event.type === "turn.completed") {
            usage = event.usage || null;
          }
        }

        // Return Thread-compatible result with full information
        return {
          threadId: thread.id || undefined,
          output: finalResponse,
          success: true,
          items,
          usage,
          threadResult: { items, finalResponse, usage },
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
   *
   * @param steps - Array of task descriptions to execute in sequence
   * @returns Promise resolving to array of results for each step
   *
   * @example
   * ```typescript
   * const results = await agent.workflow([
   *   'Create a test file',
   *   'Add some content',
   *   'Run tests'
   * ]);
   * ```
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
   * Useful for seeing what commands/tools were executed
   *
   * @param result - The delegation result
   * @returns Array of tool uses with name and input
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
   * Useful for seeing what files were modified
   *
   * @param result - The delegation result
   * @returns Array of file changes with path and status
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
   *
   * @param result - The delegation result
   * @returns Summary string with output, tools used, files modified, and token usage
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
