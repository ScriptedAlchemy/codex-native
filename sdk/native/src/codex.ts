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
import type {
  NativeConversationConfig,
  NativeConversationListPage,
  NativeConversationSummary,
} from "./nativeBinding";
import type { StreamedTurn, Turn } from "./thread";
import { Thread } from "./thread";
import { ThreadOptions } from "./threadOptions";
import { TurnOptions } from "./turnOptions";
import { ThreadEvent, ThreadError, Usage } from "./events";
import { ThreadItem } from "./items";
import { createOutputSchemaFile, normalizeOutputSchema } from "./outputSchemaFile";
import { buildReviewPrompt, type ReviewInvocationOptions } from "./reviewOptions";
import { LspManager } from "./lsp/manager";
import type { LspManagerOptions } from "./lsp/types";
import { formatDiagnosticsForTool } from "./lsp/format";
import type { SkillDefinition, SkillMentionTrigger, SkillRegistry } from "./skills";
import { normalizeSkillDefinition } from "./skills";

export type NativeToolInterceptorContext = {
  invocation: NativeToolInvocation;
  callBuiltin: (invocation?: NativeToolInvocation) => Promise<NativeToolResult>;
};

export type ConversationSummary = NativeConversationSummary;

export type ConversationListPage = NativeConversationListPage;

export type ConversationListOptions = ThreadOptions & {
  pageSize?: number;
  cursor?: string;
  modelProviders?: string[];
};

export type { ApprovalRequest } from "./nativeBinding";

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
  private readonly lspForTools: LspManager | null;
  private readonly skills: SkillRegistry = new Map();
  private readonly skillMentionTriggers: SkillMentionTrigger[];

  constructor(options: CodexOptions = {}) {
    const predefinedTools = options.tools ? [...options.tools] : [];
    const preserveRegisteredTools = options.preserveRegisteredTools === true;
    this.nativeBinding = getNativeBinding();
    this.options = { ...options, tools: [] };
    if (this.nativeBinding) {
      // clearRegisteredTools may not be available in all builds
      if (!preserveRegisteredTools && typeof this.nativeBinding.clearRegisteredTools === "function") {
        this.nativeBinding.clearRegisteredTools();
      }
      for (const tool of predefinedTools) {
        this.registerTool(tool);
      }
    }
    this.lspForTools = this.createLspManagerForTools();
    if (this.lspForTools && this.nativeBinding) {
      this.registerDefaultReadFileInterceptor();
    }
    this.skillMentionTriggers = normalizeSkillMentionTriggers(options.skillMentionTriggers);
    this.registerSkillsFromConfig(options.skills);
    this.exec = new CodexExec();
  }

  registerSkill(skill: SkillDefinition): void {
    const normalized = normalizeSkillDefinition(skill);
    this.skills.set(normalized.name, normalized);
  }

  registerSkills(skills: SkillDefinition[]): void {
    for (const skill of skills) {
      this.registerSkill(skill);
    }
  }

  listSkills(): SkillDefinition[] {
    return [...this.skills.values()];
  }

  clearSkills(): void {
    this.skills.clear();
  }

  private registerSkillsFromConfig(config: CodexOptions["skills"]): void {
    if (!config) {
      return;
    }
    if (Array.isArray(config)) {
      this.registerSkills(config);
      return;
    }
    if (typeof config !== "object") {
      throw new Error("skills must be an array or object when provided");
    }
    for (const [name, value] of Object.entries(config)) {
      if (typeof value === "string") {
        this.registerSkill({ name, contents: value });
        continue;
      }
      if (!value || typeof value !== "object") {
        throw new Error(`Invalid skill entry for ${name}`);
      }
      this.registerSkill({ name, ...value });
    }
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
    if (typeof this.nativeBinding.registerTool !== "function") {
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
      typeof this.nativeBinding.registerToolInterceptor !== "function" ||
      typeof this.nativeBinding.callToolBuiltin !== "function"
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
    if (typeof this.nativeBinding.clearRegisteredTools === "function") {
      this.nativeBinding.clearRegisteredTools();
    }
    if (this.options.tools) {
      this.options.tools = [];
    }
  }

  private buildConversationConfig(options: ThreadOptions = {}): NativeConversationConfig {
    return {
      model: options.model ?? this.options.defaultModel,
      modelProvider: options.modelProvider ?? this.options.modelProvider,
      oss: options.oss,
      sandboxMode: options.sandboxMode,
      approvalMode: options.approvalMode,
      workspaceWriteOptions: options.workspaceWriteOptions,
      workingDirectory: options.workingDirectory,
      skipGitRepoCheck: options.skipGitRepoCheck,
      reasoningEffort: options.reasoningEffort,
      reasoningSummary: options.reasoningSummary,
      fullAuto: options.fullAuto,
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
    };
  }

  private createLspManagerForTools(): LspManager | null {
    const cwd =
      typeof process !== "undefined" && typeof process.cwd === "function"
        ? process.cwd()
        : ".";
    const options: LspManagerOptions = {
      workingDirectory: cwd,
      waitForDiagnostics: true,
    };
    try {
      return new LspManager(options);
    } catch {
      return null;
    }
  }

  private registerDefaultReadFileInterceptor(): void {
    if (!this.lspForTools) {
      return;
    }
    try {
      this.registerToolInterceptor("read_file", async ({ invocation, callBuiltin }) => {
        let base: NativeToolResult;
        try {
          base = await callBuiltin();
        } catch (err) {
          // If the native binding no longer has a pending builtin (e.g., token mismatch),
          // fall back to the raw invocation result instead of failing the turn.
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            output: undefined,
          };
        }
        if (!base.output || base.success === false) {
          return base;
        }

        let filePath: string | undefined;
        if (invocation.arguments) {
          try {
            const args = JSON.parse(invocation.arguments) as {
              file_path?: unknown;
              path?: unknown;
            };
            const candidate =
              (typeof args.file_path === "string" && args.file_path) ||
              (typeof args.path === "string" && args.path) ||
              undefined;
            if (candidate && candidate.trim().length > 0) {
              filePath = candidate;
            }
          } catch {
            // ignore malformed args
          }
        }
        if (!filePath) {
          return base;
        }

        let diagnosticsText = "";
        try {
          const results = await this.lspForTools!.collectDiagnostics([filePath]);
          if (!results.length) {
            return base;
          }
          diagnosticsText = formatDiagnosticsForTool(results);
        } catch {
          return base;
        }

        if (!diagnosticsText) {
          return base;
        }

        const header = `LSP diagnostics for ${filePath}:\n${diagnosticsText}`;
        return prependSystemHintToToolResult(base, header);
      });
    } catch {
      // Interceptor support may be unavailable; fail silently.
    }
  }

  /**
   * Register a programmatic approval callback that Codex will call before executing
   * sensitive operations (e.g., shell commands, file writes).
   */
  setApprovalCallback(
    handler: (request: ApprovalRequest) => boolean | Promise<boolean>,
  ): void {
    if (!this.nativeBinding || typeof this.nativeBinding.registerApprovalCallback !== "function") {
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
    const threadOptions: ThreadOptions = {
      ...options,
      model: options.model ?? this.options.defaultModel,
    };
    return new Thread(this.exec, this.options, threadOptions, null, {
      codexSkills: this.skills,
      codexSkillMentionTriggers: this.skillMentionTriggers,
    });
  }

  /**
   * Resumes a conversation with an agent based on the thread id.
   * Threads are persisted in ~/.codex/sessions.
   *
   * @param id The id of the thread to resume.
   * @returns A new thread instance.
   */
  resumeThread(id: string, options: ThreadOptions = {}): Thread {
    const threadOptions: ThreadOptions = {
      ...options,
      model: options.model ?? this.options.defaultModel,
    };
    return new Thread(this.exec, this.options, threadOptions, id, {
      codexSkills: this.skills,
      codexSkillMentionTriggers: this.skillMentionTriggers,
    });
  }

  async listConversations(options: ConversationListOptions = {}): Promise<ConversationListPage> {
    const request = {
      config: this.buildConversationConfig(options),
      pageSize: options.pageSize,
      cursor: options.cursor,
      modelProviders: options.modelProviders,
    };
    return this.exec.listConversations(request);
  }

  async deleteConversation(id: string, options: ThreadOptions = {}): Promise<boolean> {
    const result = await this.exec.deleteConversation({
      id,
      config: this.buildConversationConfig(options),
    });
    return result.deleted;
  }

  async resumeConversationFromRollout(
    rolloutPath: string,
    options: ThreadOptions = {},
  ): Promise<Thread> {
    const result = await this.exec.resumeConversationFromRollout({
      rolloutPath,
      config: this.buildConversationConfig(options),
    });
    const threadOptions: ThreadOptions = {
      ...options,
      model: options.model ?? this.options.defaultModel,
    };
    return new Thread(this.exec, this.options, threadOptions, result.threadId, {
      codexSkills: this.skills,
      codexSkillMentionTriggers: this.skillMentionTriggers,
    });
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
      if (event === null) continue;
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
      modelProvider: threadOptions.modelProvider ?? this.options.modelProvider,
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

function normalizeSkillMentionTriggers(
  triggers: CodexOptions["skillMentionTriggers"],
): SkillMentionTrigger[] {
  if (!triggers) {
    return ["$"];
  }
  if (!Array.isArray(triggers)) {
    throw new Error("skillMentionTriggers must be an array when provided");
  }
  const normalized = triggers.filter(
    (value): value is SkillMentionTrigger => value === "$" || value === "@",
  );
  return normalized.length > 0 ? normalized : ["$"];
}

function prependSystemHintToToolResult(
  base: NativeToolResult,
  hint: string,
): NativeToolResult {
  const trimmedHint = hint.trim();
  if (!trimmedHint) {
    return base;
  }
  const existing = base.output ?? "";
  const separator = existing.length === 0 || existing.startsWith("\n") ? "\n\n" : "\n\n";
  const output = existing.length === 0
    ? `[SYSTEM_HINT]\n${trimmedHint}`
    : `[SYSTEM_HINT]\n${trimmedHint}${separator}${existing}`;
  return {
    ...base,
    output,
  };
}
