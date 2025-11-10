import { CodexOptions, NativeToolDefinition } from "./codexOptions";
import { CodexExec } from "./exec";
import {
  NativeBinding,
  getNativeBinding,
  NativeToolInvocation,
  NativeToolResult,
  NativeToolInterceptorNativeContext,
  ApprovalRequest,
} from "./nativeBinding";
import type { StreamedTurn, Turn } from "./thread";
import { Thread } from "./thread";
import { ThreadOptions } from "./threadOptions";
import { TurnOptions } from "./turnOptions";
import { ThreadEvent, ThreadError, Usage } from "./events";
import { ThreadItem } from "./items";
import { createOutputSchemaFile, normalizeOutputSchema } from "./outputSchemaFile";
import { buildReviewPrompt, type ReviewInvocationOptions } from "./reviewOptions";

export type NativeToolInterceptorContext = {
  invocation: NativeToolInvocation;
  callBuiltin: (invocation?: NativeToolInvocation) => Promise<NativeToolResult>;
};

/**
 * Codex is the main class for interacting with the Codex agent.
 *
 * This is the native NAPI-based implementation that uses Rust bindings directly.
 *
 * Use the `startThread()` method to start a new thread or `resumeThread()` to resume a previously started thread.
 */
export class Codex {
  private exec: CodexExec;
  private options: CodexOptions;
  private readonly nativeBinding: NativeBinding | null;

  constructor(options: CodexOptions = {}) {
    const predefinedTools = options.tools ? [...options.tools] : [];
    this.nativeBinding = getNativeBinding();
    this.options = { ...options, tools: [] };
    if (this.nativeBinding) {
      // clearRegisteredTools may not be available in all builds
      if (typeof this.nativeBinding.clearRegisteredTools === 'function') {
        this.nativeBinding.clearRegisteredTools();
      }
      for (const tool of predefinedTools) {
        this.registerTool(tool);
      }
    }
    this.exec = new CodexExec();
  }

  /**
   * Register a tool for Codex. When `tool.name` matches a built-in Codex tool,
   * the native implementation is replaced for this Codex instance.
   */
  registerTool(tool: NativeToolDefinition): void {
    if (!this.nativeBinding) {
      throw new Error("Native tool registration requires the NAPI binding");
    }
    // registerTool may not be available in all builds
    if (typeof this.nativeBinding.registerTool !== 'function') {
      console.warn("registerTool is not available in this build - tools feature may be incomplete");
      return;
    }
    const { handler, ...info } = tool;
    this.nativeBinding.registerTool(info, handler);
    if (!this.options.tools) {
      this.options.tools = [];
    }
    this.options.tools.push(tool);
  }

  /**
   * Register a tool interceptor for Codex. Interceptors can modify tool invocations
   * and results, and can call the built-in implementation.
   */
  registerToolInterceptor(
    toolName: string,
    handler: (context: NativeToolInterceptorContext) => Promise<NativeToolResult> | NativeToolResult,
  ): void {
    if (!this.nativeBinding) {
      throw new Error("Native tool interceptor registration requires the NAPI binding");
    }
    // registerToolInterceptor may not be available in all builds
    if (
      typeof this.nativeBinding.registerToolInterceptor !== 'function' ||
      typeof this.nativeBinding.callToolBuiltin !== 'function'
    ) {
      console.warn("registerToolInterceptor is not available in this build - interceptor feature may be incomplete");
      return;
    }
    this.nativeBinding.registerToolInterceptor(toolName, async (...args: unknown[]) => {
      const context = (args.length === 1 ? args[0] : args[1]) as
        | NativeToolInterceptorNativeContext
        | null
        | undefined;
      if (!context || typeof context !== "object") {
        throw new Error("Native interceptor callback did not receive a context object");
      }
      const { invocation, token } = context;
      const callBuiltin = (override?: NativeToolInvocation) =>
        this.nativeBinding!.callToolBuiltin(token, override ?? invocation);
      return handler({ invocation, callBuiltin });
    });
  }

  /**
   * Clear all registered tools, restoring built-in defaults.
   */
  clearTools(): void {
    if (!this.nativeBinding) {
      throw new Error("Native tool management requires the NAPI binding");
    }
    if (typeof this.nativeBinding.clearRegisteredTools === 'function') {
      this.nativeBinding.clearRegisteredTools();
    }
    if (this.options.tools) {
      this.options.tools = [];
    }
  }

  /**
   * Register a programmatic approval callback that Codex will call before executing
   * sensitive operations (e.g., shell commands, file writes).
   */
  setApprovalCallback(
    handler: (request: ApprovalRequest) => boolean | Promise<boolean>,
  ): void {
    if (!this.nativeBinding || typeof this.nativeBinding.registerApprovalCallback !== 'function') {
      console.warn("Approval callback is not available in this build");
      return;
    }
    this.nativeBinding.registerApprovalCallback(handler);
  }

  /**
   * Starts a new conversation with an agent.
   * @returns A new thread instance.
   */
  startThread(options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options);
  }

  /**
   * Resumes a conversation with an agent based on the thread id.
   * Threads are persisted in ~/.codex/sessions.
   *
   * @param id The id of the thread to resume.
   * @returns A new thread instance.
   */
  resumeThread(id: string, options: ThreadOptions = {}): Thread {
    return new Thread(this.exec, this.options, options, id);
  }

  /**
   * Starts a review task using the built-in Codex review flow.
   */
  async review(options: ReviewInvocationOptions): Promise<Turn> {
    const generator = this.reviewStreamedInternal(options);
    const items: ThreadItem[] = [];
    let finalResponse = "";
    let usage: Usage | null = null;
    let turnFailure: ThreadError | null = null;
    for await (const event of generator) {
      if (event.type === "item.completed") {
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
        }
        items.push(event.item);
      } else if (event.type === "exited_review_mode") {
        // Capture the structured review output
        if (event.review_output) {
          const reviewOutput = event.review_output;
          let reviewText = "";

          // Add overall explanation
          if (reviewOutput.overall_explanation) {
            reviewText += reviewOutput.overall_explanation;
          }

          // Add findings if present
          if (reviewOutput.findings && reviewOutput.findings.length > 0) {
            if (reviewText) reviewText += "\n\n";
            reviewText += "## Review Findings\n\n";
            reviewOutput.findings.forEach((finding, index) => {
              reviewText += `### ${index + 1}. ${finding.title}\n`;
              reviewText += `${finding.body}\n`;
              reviewText += `**Priority:** ${finding.priority} | **Confidence:** ${finding.confidence_score}\n`;
              reviewText += `**Location:** ${finding.code_location.absolute_file_path}:${finding.code_location.line_range.start}-${finding.code_location.line_range.end}\n\n`;
            });
          }

          finalResponse = reviewText;
        }
      } else if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        turnFailure = event.error;
        break;
      }
    }
    if (turnFailure) {
      throw new Error(turnFailure.message);
    }
    return { items, finalResponse, usage };
  }

  /**
   * Starts a review task and returns the event stream.
   */
  async reviewStreamed(options: ReviewInvocationOptions): Promise<StreamedTurn> {
    return { events: this.reviewStreamedInternal(options) };
  }

  private async *reviewStreamedInternal(
    options: ReviewInvocationOptions,
  ): AsyncGenerator<ThreadEvent> {
    const { target, threadOptions = {}, turnOptions = {} } = options;
    const { prompt, hint } = buildReviewPrompt(target);
    const normalizedSchema = normalizeOutputSchema(turnOptions.outputSchema);
    const needsSchemaFile = this.exec.requiresOutputSchemaFile();
    const schemaFile = needsSchemaFile
      ? await createOutputSchemaFile(normalizedSchema)
      : { schemaPath: undefined, cleanup: async () => {} };
    const generator = this.exec.run({
      input: prompt,
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
      model: threadOptions.model,
      oss: threadOptions.oss,
      sandboxMode: threadOptions.sandboxMode,
      approvalMode: threadOptions.approvalMode,
      workspaceWriteOptions: threadOptions.workspaceWriteOptions,
      workingDirectory: threadOptions.workingDirectory,
      skipGitRepoCheck: threadOptions.skipGitRepoCheck,
      outputSchemaFile: schemaFile.schemaPath,
      outputSchema: normalizedSchema,
      fullAuto: threadOptions.fullAuto,
      review: {
        userFacingHint: hint,
      },
    });
    try {
      for await (const item of generator) {
        let parsed: ThreadEvent;
        try {
          parsed = JSON.parse(item) as ThreadEvent;
        } catch (error) {
          throw new Error(`Failed to parse item: ${item}`, { cause: error });
        }
        yield parsed;
      }
    } finally {
      await schemaFile.cleanup();
    }
  }
}
