/**
 * ClaudeAgent - High-level agent for delegating work to Claude Code CLI
 *
 * This class provides a simple interface for delegating tasks to Claude Code
 * by invoking the CLI in headless mode with JSON output. It handles:
 * - Task delegation with automatic retries
 * - Conversation tracking and resumption
 * - Multi-turn workflows with feedback
 * - Approval callbacks (note: CLI approval integration pending)
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

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ApprovalMode, SandboxMode } from "../threadOptions";
import type { ApprovalRequest } from "../nativeBinding";

const execAsync = promisify(exec);

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

  /**
   * Callback to handle approval requests from the agent.
   * Return true to approve, false to deny.
   *
   * Note: Approval callback integration with Claude CLI is not yet implemented.
   * The CLI will use its default approval mode for now.
   */
  onApprovalRequest?: (request: ApprovalRequest) => boolean | Promise<boolean>;
}

/**
 * Result from delegating a task to Claude Code CLI
 */
export interface DelegationResult {
  /**
   * Session ID for resuming the conversation
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
}

interface ClaudeCLIResponse {
  type: string;
  subtype: string;
  total_cost_usd?: number;
  is_error: boolean;
  duration_ms?: number;
  result: string;
  session_id?: string;
}

/**
 * ClaudeAgent provides a high-level interface for delegating work to Claude Code CLI
 */
export class ClaudeAgent {
  private options: Required<Pick<ClaudeAgentOptions, "model" | "approvalMode" | "sandboxMode" | "maxRetries" | "timeout">>;
  private workingDirectory?: string;
  private appendSystemPrompt?: string;
  private approvalHandler?: (request: ApprovalRequest) => boolean | Promise<boolean>;

  constructor(options: ClaudeAgentOptions = {}) {
    this.options = {
      model: options.model || "claude-sonnet-4-5-20250929",
      approvalMode: options.approvalMode || "on-request",
      sandboxMode: options.sandboxMode || "workspace-write",
      maxRetries: options.maxRetries || 1,
      timeout: options.timeout || 300000, // 5 minutes for Claude CLI
    };
    this.workingDirectory = options.workingDirectory || process.cwd();
    this.appendSystemPrompt = options.appendSystemPrompt;
    this.approvalHandler = options.onApprovalRequest;
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
  private async executeTask(prompt: string, sessionId?: string): Promise<DelegationResult> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        // Build Claude CLI command
        let command: string;
        if (sessionId) {
          command = `claude --resume ${sessionId} "${prompt.replace(/"/g, '\\"')}" --output-format json`;
        } else {
          command = `claude -p "${prompt.replace(/"/g, '\\"')}" --output-format json`;
        }

        // Add model if specified
        if (this.options.model) {
          command += ` --model ${this.options.model}`;
        }

        // Execute Claude CLI
        const { stdout } = await execAsync(command, {
          cwd: this.workingDirectory,
          maxBuffer: 10 * 1024 * 1024,
          timeout: this.options.timeout,
        });

        const response = JSON.parse(stdout) as ClaudeCLIResponse;

        if (response.is_error) {
          throw new Error(`Claude CLI error: ${response.result}`);
        }

        // Return result with thread ID from session
        return {
          threadId: response.session_id,
          output: response.result || "",
          success: true,
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

}
