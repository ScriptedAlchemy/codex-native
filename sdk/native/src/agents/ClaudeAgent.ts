/**
 * ClaudeAgent - High-level agent for delegating work to Claude Code CLI
 *
 * This class provides a simple interface for delegating tasks to Claude Code
 * by invoking the CLI in headless mode with JSON output. It handles:
 * - Task delegation with automatic retries
 * - Conversation tracking and resumption
 * - Multi-turn workflows with feedback
 * - Approval callbacks via MCP server bridge
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

import { exec, spawn, ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
   * When provided, an MCP server is automatically started to bridge approval
   * requests between the Claude CLI process and this callback.
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
  private approvalServer?: ChildProcess;
  private mcpConfigPath?: string;

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
   * Start MCP approval server for handling approval requests
   * Returns the path to the MCP config file
   */
  private async startApprovalServer(): Promise<string> {
    if (!this.approvalHandler) {
      throw new Error("Approval handler not configured");
    }

    return new Promise((resolve, reject) => {
      // Create MCP server script
      const serverScriptPath = join(tmpdir(), `mcp-approval-server-${Date.now()}.mjs`);
      const serverCode = `
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'codex-approval-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'approve',
        description: 'Request approval for an action. Returns approval decision.',
        inputSchema: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              description: 'The type of action (shell, file_write, network_access)',
            },
            details: {
              type: 'object',
              description: 'Details about the action',
            },
          },
          required: ['type'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'approve') {
    const args = request.params.arguments;

    // Send to parent process for review
    process.send({ type: 'approval_request', data: args });

    // Wait for decision
    return new Promise((resolve) => {
      process.once('message', (msg) => {
        if (msg.type === 'approval_decision') {
          const approved = msg.data.approved;
          const reason = msg.data.reason || 'No reason provided';

          resolve({
            content: [
              {
                type: 'text',
                text: approved
                  ? \`✅ APPROVED: \${reason}\`
                  : \`❌ DENIED: \${reason}\`,
              },
            ],
          });
        }
      });
    });
  }

  throw new Error(\`Unknown tool: \${request.params.name}\`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
`;

      // Write server script to temp file
      writeFileSync(serverScriptPath, serverCode);

      // Create MCP config
      const mcpConfig = {
        "mcpServers": {
          "codex-approval-server": {
            "command": "npx",
            "args": ["tsx", serverScriptPath],
          },
        },
      };

      // Write MCP config to temp file
      this.mcpConfigPath = join(tmpdir(), `mcp-config-${Date.now()}.json`);
      writeFileSync(this.mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

      // Start server as child process with IPC for approval routing
      this.approvalServer = spawn("npx", ["tsx", serverScriptPath], {
        stdio: ["pipe", "pipe", "pipe", "ipc"],
        cwd: this.workingDirectory,
      });

      // Handle approval requests
      this.approvalServer.on("message", async (msg: any) => {
        if (msg.type === "approval_request" && this.approvalHandler) {
          const request: ApprovalRequest = {
            type: msg.data.type || "shell",
            details: msg.data.details,
          };

          try {
            const approved = await this.approvalHandler(request);
            this.approvalServer!.send({
              type: "approval_decision",
              data: { approved, reason: approved ? "Approved by handler" : "Denied by handler" },
            });
          } catch (error: any) {
            // Fail closed
            this.approvalServer!.send({
              type: "approval_decision",
              data: { approved: false, reason: `Error: ${error.message}` },
            });
          }
        }
      });

      this.approvalServer.on("error", (err) => {
        reject(new Error(`Approval server error: ${err.message}`));
      });

      // Give server time to start, then resolve with MCP config path
      setTimeout(() => {
        if (this.mcpConfigPath) {
          resolve(this.mcpConfigPath);
        } else {
          reject(new Error("MCP config path not set"));
        }
      }, 1000);
    });
  }

  /**
   * Stop approval server and clean up temp files
   */
  private stopApprovalServer(): void {
    if (this.approvalServer) {
      this.approvalServer.kill();
      this.approvalServer = undefined;
    }
    if (this.mcpConfigPath) {
      try {
        unlinkSync(this.mcpConfigPath);
      } catch (e) {
        // Ignore cleanup errors
      }
      this.mcpConfigPath = undefined;
    }
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
    let serverStarted = false;
    let mcpConfigPath: string | undefined;

    try {
      // Start approval server if handler is configured
      if (this.approvalHandler && !this.approvalServer) {
        mcpConfigPath = await this.startApprovalServer();
        serverStarted = true;
      }

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

          // Add MCP config for approval server
          if (mcpConfigPath) {
            command += ` --mcp-config "${mcpConfigPath}" --strict-mcp-config`;
            command += ` --permission-prompt-tool mcp__codex-approval-server__approve`;
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
    } finally {
      // Clean up approval server if we started it
      if (serverStarted) {
        this.stopApprovalServer();
      }
    }
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
