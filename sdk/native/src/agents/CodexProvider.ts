import type { Codex } from "../codex";
import type { Thread } from "../thread";
import type { ThreadEvent, Usage as CodexUsage } from "../events";
import type { ThreadItem } from "../items";
import type { Input, UserInput } from "../thread";
import type { CodexOptions, NativeToolDefinition } from "../codexOptions";
import type { ThreadOptions } from "../threadOptions";
import type { NativeToolInvocation, NativeToolResult } from "../nativeBinding";
import { getCodexToolExecutor, type ToolExecutor, type ToolExecutionContext, type ToolExecutorResult } from "./toolRegistry";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type {
  ModelProvider,
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  AgentInputItem,
  AgentOutputItem,
  AssistantMessageItem,
  OutputText,
  SerializedTool,
} from "./types";
import { Usage } from "./types";

/**
 * Options for creating a CodexProvider
 */
export interface CodexProviderOptions extends CodexOptions {
  /**
   * Default model to use when none is specified
   */
  defaultModel?: string;

  /**
   * Working directory for Codex operations
   * @default process.cwd()
   */
  workingDirectory?: string;

  /**
   * Skip git repository check
   * @default false
   */
  skipGitRepoCheck?: boolean;

  /**
   * Sandbox policy to use when executing shell commands
   * @default "danger-full-access"
   */
  sandboxMode?: ThreadOptions["sandboxMode"];
}

/**
 * Provider implementation that uses Codex as the backend for OpenAI Agents
 *
 * @example
 * ```typescript
 * import { CodexProvider } from '@openai/codex-native/agents';
 * import { Agent, Runner } from '@openai/agents';
 *
 *   defaultModel: 'gpt-5-codex'
 * });
 *
 * const agent = new Agent({
 *   name: 'CodeAssistant',
 *   instructions: 'You are a helpful coding assistant'
 * });
 *
 * const runner = new Runner({ modelProvider: provider });
 * const result = await runner.run(agent, 'Fix the failing tests');
 * ```
 */
export class CodexProvider implements ModelProvider {
  private codex: Codex | null = null;
  private options: CodexProviderOptions;

  constructor(options: CodexProviderOptions = {}) {
    this.options = {
      workingDirectory: options.workingDirectory || process.cwd(),
      skipGitRepoCheck: options.skipGitRepoCheck ?? false,
      ...options,
    };
  }

  /**
   * Lazy initialization of Codex instance
   */
  private getCodex(): Codex {
    if (!this.codex) {
      try {
        // Dynamic import to avoid circular dependencies
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Codex: CodexClass } = require("../codex");
        if (!CodexClass) {
          throw new Error("Codex class not found in module");
        }
        this.codex = new CodexClass({
          apiKey: this.options.apiKey,
          baseUrl: this.options.baseUrl,
        }) as Codex;
      } catch (error) {
        throw new Error(
          `Failed to initialize Codex: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
    return this.codex;
  }

  getModel(modelName?: string): Model {
    const model = modelName || this.options.defaultModel;
    return new CodexModel(this.getCodex(), model, this.options);
  }
}

/**
 * Model implementation that wraps a Codex Thread
 */
class CodexModel implements Model {
  private codex: Codex;
  private modelName?: string;
  private thread: Thread | null = null;
  private options: CodexProviderOptions;
  private registeredTools: Set<string> = new Set();
  private toolExecutors: Map<string, ToolExecutor> = new Map();
  private tempImageFiles: Set<string> = new Set();
  private streamedTurnItems: ThreadItem[] = [];
  private lastStreamedMessage: string | null = null;

  constructor(codex: Codex, modelName: string | undefined, options: CodexProviderOptions) {
    this.codex = codex;
    this.modelName = modelName;
    this.options = options;
  }

  /**
   * Cleanup temporary image files created during request processing
   */
  private async cleanupTempFiles(): Promise<void> {
    for (const filepath of this.tempImageFiles) {
      try {
        await fs.promises.unlink(filepath);
      } catch (error) {
        // Silently ignore cleanup errors (file may already be deleted)
      }
    }
    this.tempImageFiles.clear();
  }

  /**
   * Get or create the thread for this model instance
   */
  private getThread(conversationId?: string): Thread {
    // If we have a conversation ID and either no thread or a different thread
    if (conversationId) {
      if (!this.thread || this.thread.id !== conversationId) {
        // Resume the specified thread
        this.thread = this.codex.resumeThread(conversationId, this.getThreadOptions());
      }
    } else if (!this.thread) {
      // Create new thread only if we don't have one
      this.thread = this.codex.startThread(this.getThreadOptions());
    }
    return this.thread;
  }

  private getThreadOptions(): ThreadOptions {
    return {
      model: this.modelName,
      workingDirectory: this.options.workingDirectory,
      skipGitRepoCheck: this.options.skipGitRepoCheck,
      sandboxMode: this.options.sandboxMode ?? "danger-full-access",
    };
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    try {
      const thread = this.getThread(request.conversationId || request.previousResponseId);

      // Register any tools provided in the request
      if (request.tools && request.tools.length > 0) {
        this.registerRequestTools(request.tools);
      }

      const input = await this.convertRequestToInput(request);

      // Note: ModelSettings like temperature, maxTokens, topP, etc. are not currently
      // supported by the Codex native binding. The Rust layer handles model configuration.

      // Run Codex (tools are now registered and will be available)
      const turn = await thread.run(input, {
        outputSchema: typeof request.outputType === 'object' ? request.outputType.schema : undefined,
      });

      // Convert Codex response to ModelResponse format
      return {
        usage: this.convertUsage(turn.usage),
        output: this.convertItemsToOutput(turn.items, turn.finalResponse),
        responseId: thread.id || undefined,
      };
    } finally {
      // Clean up temporary image files
      await this.cleanupTempFiles();
    }
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const MAX_ACCUMULATED_SIZE = 10_000_000; // 10MB limit

    try {
      const thread = this.getThread(request.conversationId || request.previousResponseId);

      // Register any tools provided in the request
      if (request.tools && request.tools.length > 0) {
        this.registerRequestTools(request.tools);
      }

      const input = await this.convertRequestToInput(request);

      const { events } = await thread.runStreamed(input, {
        outputSchema: typeof request.outputType === 'object' ? request.outputType.schema : undefined,
      });

      // Track text accumulation for delta calculation
      const textAccumulator = new Map<string, string>();

      for await (const event of events) {
        // Check accumulated text size to prevent memory issues
        let totalSize = 0;
        for (const text of textAccumulator.values()) {
          totalSize += text.length;
        }
        if (totalSize > MAX_ACCUMULATED_SIZE) {
          throw new Error(`Accumulated text exceeded maximum size limit (${MAX_ACCUMULATED_SIZE} bytes)`);
        }

        const streamEvents = this.convertCodexEventToStreamEvent(event, textAccumulator);

        for (const streamEvent of streamEvents) {
          yield streamEvent;
        }
      }
    } finally {
      // Clean up temporary image files
      await this.cleanupTempFiles();
    }
  }

  /**
   * Register tools from ModelRequest with the Codex instance
   *
   * Converts SerializedTool format (OpenAI Agents) to NativeToolDefinition format (Codex)
   * and registers them with the Codex instance for bidirectional tool execution.
   */
  private registerRequestTools(tools: SerializedTool[]): void {
    this.toolExecutors.clear();

    for (const tool of tools) {
      if (tool.type !== "function") {
        continue;
      }

      // Skip if already registered
      if (this.registeredTools.has(tool.name)) {
        const executor = this.resolveToolExecutor(tool.name);
        if (executor) {
          this.toolExecutors.set(tool.name, executor);
        }
        continue;
      }

      try {
        const executor = this.resolveToolExecutor(tool.name);
        if (executor) {
          this.toolExecutors.set(tool.name, executor);
        }

        // Convert SerializedTool to NativeToolDefinition
        const nativeToolDef: NativeToolDefinition = {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          // The handler is called when Codex wants to execute this tool
          handler: async (invocation: NativeToolInvocation): Promise<NativeToolResult> => {
            return await this.executeToolViaFramework(invocation);
          },
        };

        // Register the tool with Codex
        this.codex.registerTool(nativeToolDef);
        this.registeredTools.add(tool.name);

        console.log(`Registered tool with Codex: ${tool.name}`);
      } catch (error) {
        const errorMessage = `Failed to register tool ${tool.name}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(errorMessage);
        // Don't throw - allow other tools to register even if one fails
        // Individual tool failures shouldn't block the entire request
      }
    }
  }

  private resolveToolExecutor(toolName: string): ToolExecutor | undefined {
    return getCodexToolExecutor(toolName);
  }

  /**
   * Execute a tool via the OpenAI Agents framework
   *
   * This is the bridge between Codex's tool execution and the framework's tool handlers.
   *
   * FRAMEWORK INTEGRATION NOTE:
   * This method currently returns a placeholder result because the actual execution
   * requires integration with the OpenAI Agents framework's tool execution loop.
   *
   * In a full implementation, this would:
   * 1. Emit a "tool_call_requested" event that the framework can listen to
   * 2. Wait for the framework to execute the tool and provide the result
   * 3. Return that result to Codex
   *
   * For now, this creates a promise that could be resolved by framework code,
   * but the framework integration is not yet complete.
   */
  private async executeToolViaFramework(
    invocation: NativeToolInvocation
  ): Promise<NativeToolResult> {
    const executor = this.toolExecutors.get(invocation.toolName) ?? getCodexToolExecutor(invocation.toolName);
    if (!executor) {
      const message = `No Codex executor registered for tool '${invocation.toolName}'. Use codexTool() or provide a codexExecute handler.`;
      console.warn(message);
      return {
        success: false,
        error: message,
        output: undefined,
      };
    }

    let parsedArguments: unknown = {};
    if (invocation.arguments) {
      try {
        parsedArguments = JSON.parse(invocation.arguments);
      } catch (error) {
        return {
          success: false,
          error: `Failed to parse tool arguments: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    const context: ToolExecutionContext = {
      name: invocation.toolName,
      callId: invocation.callId,
      arguments: parsedArguments,
      rawInvocation: invocation,
    };

    try {
      const result = await executor(context);
      return this.normalizeToolResult(result);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Handle image input by converting to local file path
   * Supports: base64 data URLs, HTTP(S) URLs, and file IDs (not yet implemented)
   */
  private normalizeToolResult(result: ToolExecutorResult): NativeToolResult {
    if (result === undefined || result === null) {
      return { success: true };
    }

    if (typeof result === "string") {
      return { success: true, output: result };
    }

    if (typeof result === "object" && ("output" in result || "error" in result || "success" in result)) {
      return {
        success: result.success ?? !result.error,
        output: result.output,
        error: result.error,
      };
    }

    return {
      success: true,
      output: JSON.stringify(result),
    };
  }

  private async handleImageInput(item: any): Promise<string | null> {
    const imageValue = item.image;

    // Case 1: Already a local file path (less common but possible)
    if (typeof imageValue === "string") {
      // Check if it's a base64 data URL
      if (imageValue.startsWith("data:image/")) {
        return await this.saveBase64Image(imageValue);
      }
      // Check if it's an HTTP(S) URL
      else if (imageValue.startsWith("http://") || imageValue.startsWith("https://")) {
        return await this.downloadImage(imageValue);
      }
      // Assume it's already a file path
      else if (fs.existsSync(imageValue)) {
        return imageValue;
      }
      // Invalid format
      else {
        throw new Error(`Invalid image format: ${imageValue.substring(0, 50)}...`);
      }
    }
    // Case 2: Object with url property
    else if (typeof imageValue === "object" && "url" in imageValue) {
      return await this.downloadImage(imageValue.url);
    }
    // Case 3: Object with fileId property (would need API access to download)
    else if (typeof imageValue === "object" && "fileId" in imageValue) {
      throw new Error(
        `Image fileId references are not yet supported. ` +
        `File IDs would need to be downloaded from the service first.`
      );
    }

    return null;
  }

  /**
   * Save base64-encoded image to temporary file
   */
  private async saveBase64Image(dataUrl: string): Promise<string> {
    // Extract media type and base64 data
    const matches = dataUrl.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Invalid base64 image data URL");
    }

    const mediaType = matches[1];
    const base64Data = matches[2];
    if (!base64Data) {
      throw new Error("Invalid base64 data in image URL");
    }

    const sanitizedBase64 = base64Data.replace(/\s/g, "");
    if (sanitizedBase64.length === 0) {
      throw new Error("Invalid base64 data in image URL");
    }

    if (!/^[A-Za-z0-9+/=_-]+$/.test(sanitizedBase64)) {
      throw new Error("Invalid base64 data in image URL");
    }

    const normalizedBase64 = sanitizedBase64.replace(/-/g, "+").replace(/_/g, "/");

    let buffer: Buffer;
    try {
      buffer = Buffer.from(normalizedBase64, "base64");
    } catch {
      throw new Error("Invalid base64 data in image URL");
    }

    if (buffer.length === 0) {
      throw new Error("Invalid base64 data in image URL");
    }

    const reencoded = buffer.toString("base64").replace(/=+$/, "");
    const normalizedInput = normalizedBase64.replace(/=+$/, "");
    if (reencoded !== normalizedInput) {
      throw new Error("Invalid base64 data in image URL");
    }

    // Extract extension from media type, handling various formats
    // Examples: "png", "jpeg", "svg+xml", "vnd.microsoft.icon"
    const extension = this.getExtensionFromMediaType(mediaType, "png");

    // Create temp file
    const tempDir = os.tmpdir();
    const filename = `codex-image-${Date.now()}.${extension}`;
    const filepath = path.join(tempDir, filename);

    await fs.promises.writeFile(filepath, buffer);
    this.tempImageFiles.add(filepath);
    return filepath;
  }

  /**
   * Download image from URL to temporary file
   */
  private async downloadImage(url: string): Promise<string> {
    // Use fetch to download the image
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download image from ${url}: ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/png";

    // Extract media type from content-type (e.g., "image/png; charset=utf-8" -> "png")
    const mediaTypePart = contentType.split(";")[0]?.trim() || "image/png";
    const mediaType = mediaTypePart.split("/")[1] || "png";
    const extension = this.getExtensionFromMediaType(mediaType, "png");

    // Create temp file
    const tempDir = os.tmpdir();
    const filename = `codex-image-${Date.now()}.${extension}`;
    const filepath = path.join(tempDir, filename);

    await fs.promises.writeFile(filepath, Buffer.from(buffer));
    this.tempImageFiles.add(filepath);
    return filepath;
  }

  /**
   * Convert media type to file extension
   * Handles special cases like "jpeg" -> "jpg", "svg+xml" -> "svg"
   */
  private getExtensionFromMediaType(mediaType: string | undefined, defaultExt: string): string {
    if (!mediaType) {
      return defaultExt;
    }

    // Normalize the media type
    const normalized = mediaType.toLowerCase().trim();

    // Handle special cases
    const extensionMap: Record<string, string> = {
      "jpeg": "jpg",
      "svg+xml": "svg",
      "vnd.microsoft.icon": "ico",
      "x-icon": "ico",
    };

    // Check if we have a mapping for this media type
    if (extensionMap[normalized]) {
      return extensionMap[normalized];
    }

    // For standard types like "png", "gif", "webp", "bmp", "tiff"
    // Just use the media type as the extension
    const simpleExtension = normalized.split("+")[0]; // Handle cases like "svg+xml"

    // Validate it's a reasonable extension (alphanumeric only)
    if (simpleExtension && /^[a-z0-9]+$/.test(simpleExtension)) {
      return simpleExtension;
    }

    // Fall back to default if we can't determine a valid extension
    return defaultExt;
  }

  private async convertRequestToInput(request: ModelRequest): Promise<Input> {
    const parts: UserInput[] = [];

    // Add system instructions as a text preamble if provided
    if (request.systemInstructions) {
      parts.push({
        type: "text",
        text: `<system>\n${request.systemInstructions}\n</system>\n\n`,
      });
    }

    // Convert input
    if (typeof request.input === "string") {
      parts.push({ type: "text", text: request.input });
    } else {
      // Convert AgentInputItem[] to UserInput[]
      for (const item of request.input) {
        // Handle different item types
        if (item.type === "function_call_result") {
          // Tool results - for now, convert to text describing the result
          const result = item as any;
          parts.push({
            type: "text",
            text: `[Tool ${result.name} returned: ${result.result}]`
          });
        } else if (item.type === "reasoning") {
          // Reasoning content
          const reasoning = item as any;
          parts.push({
            type: "text",
            text: `[Reasoning: ${reasoning.content || reasoning.reasoning}]`
          });
        } else if ((item.type === "message" || item.type === undefined) && 'role' in item) {
          // Message item - extract content
          const messageItem = item as any;
          const content = messageItem.content;

          if (typeof content === "string") {
            parts.push({ type: "text", text: content });
          } else if (Array.isArray(content)) {
            // Process content array
            for (const contentItem of content) {
              if (contentItem.type === "input_text") {
                parts.push({ type: "text", text: contentItem.text });
              } else if (contentItem.type === "input_image") {
                const imagePath = await this.handleImageInput(contentItem);
                if (imagePath) {
                  parts.push({ type: "local_image", path: imagePath });
                }
              } else if (contentItem.type === "input_file") {
                throw new Error(
                  `CodexProvider does not yet support input_file type. ` +
                  `File handling needs to be implemented based on file type and format.`
                );
              } else if (contentItem.type === "audio") {
                throw new Error(
                  `CodexProvider does not yet support audio type. ` +
                  `Audio handling needs to be implemented.`
                );
              } else if (contentItem.type === "refusal") {
                parts.push({
                  type: "text",
                  text: `[Refusal: ${contentItem.refusal}]`
                });
              } else if (contentItem.type === "output_text") {
                parts.push({ type: "text", text: contentItem.text });
              }
            }
          }
        }
      }
    }

    // If only one text part, return as string
    if (parts.length === 1 && parts[0]!.type === "text") {
      return parts[0]!.text;
    }

    return parts;
  }

  /**
   * Convert Codex Usage to ModelResponse Usage
   */
  private convertUsage(usage: CodexUsage | null): Usage {
    if (!usage) {
      return new Usage();
    }

    const converted = new Usage({
      requests: 1,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
    });

    if (usage.cached_input_tokens) {
      converted.inputTokensDetails = [{ cachedTokens: usage.cached_input_tokens }];
    }

    return converted;
  }

  /**
   * Convert Codex ThreadItems to AgentOutputItems
   */
  private convertItemsToOutput(items: ThreadItem[], finalResponse: string): AgentOutputItem[] {
    const output: AgentOutputItem[] = [];

    for (const item of items) {
      switch (item.type) {
        case "agent_message": {
          const content = [
            {
              type: "output_text" as const,
              text: item.text,
            },
          ];

          output.push({
            type: "message",
            role: "assistant",
            status: "completed",
            content,
          } as AssistantMessageItem);
          break;
        }

        case "reasoning": {
          output.push({
            type: "reasoning",
            content: [
              {
                type: "input_text" as const,
                text: item.text,
              },
            ],
          } as any);
          break;
        }

        // Codex handles tools internally, so we don't expose them as function calls
        // The results are already incorporated into the agent_message
        case "command_execution":
        case "file_change":
        case "mcp_tool_call":
          // Skip - these are internal to Codex
          break;

        default:
          // Unknown item type - skip
          break;
      }
    }

    // If no items were converted, add the final response as a message
    if (output.length === 0 && finalResponse) {
      output.push({
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text" as const,
            text: finalResponse,
          },
        ],
      } as AssistantMessageItem);
    }

    return output;
  }

  private buildStreamResponse(
    usage: Usage,
    responseId: string,
    items: ThreadItem[],
    lastMessage: string | null
  ): any {
    const messageItems = items.filter(
      (item): item is Extract<ThreadItem, { type: "agent_message" }> => item.type === "agent_message"
    );
    const output = this.convertItemsToOutput(messageItems, lastMessage ?? "");

    // Convert Usage to plain object format expected by StreamEvent
    const usageData = {
      requests: usage.requests,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      inputTokensDetails: usage.inputTokensDetails?.[0],
      outputTokensDetails: usage.outputTokensDetails?.[0],
    };

    return {
      id: responseId,
      responseId,
      usage: usageData,
      output,
    };
  }

  /**
   * Convert Codex ThreadEvent to OpenAI Agents StreamEvent
   */
  private convertCodexEventToStreamEvent(
    event: ThreadEvent,
    textAccumulator: Map<string, string>
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    switch (event.type) {
      case "thread.started":
        events.push({ type: "response_started" });
        break;

      case "turn.started":
        // No equivalent in StreamEvent - skip
        this.streamedTurnItems = [];
        this.lastStreamedMessage = null;
        break;

      case "item.started":
        // Initialize accumulator for this item
        if (event.item.type === "agent_message" || event.item.type === "reasoning") {
          const itemKey = `${event.item.type}`;
          textAccumulator.set(itemKey, "");
        }
        break;

      case "item.updated":
        // Emit delta events for incremental text updates
        if (event.item.type === "agent_message") {
          const itemKey = "agent_message";
          const previousText = textAccumulator.get(itemKey) || "";
          const currentText = event.item.text;

          // Validate: current text should be longer than previous (no backwards updates)
          if (currentText.length < previousText.length) {
            console.warn("Received backwards update for text - ignoring delta");
            break;
          }

          if (currentText.length > previousText.length) {
            const delta = currentText.slice(previousText.length);
            textAccumulator.set(itemKey, currentText);

            events.push({
              type: "output_text_delta",
              delta,
            });
          }
        } else if (event.item.type === "reasoning") {
          const itemKey = "reasoning";
          const previousText = textAccumulator.get(itemKey) || "";
          const currentText = event.item.text;

          if (currentText.length > previousText.length) {
            const delta = currentText.slice(previousText.length);
            textAccumulator.set(itemKey, currentText);

            // Use "model" type for custom reasoning events
            events.push({
              type: "model",
              event: {
                type: "reasoning_delta",
                delta,
              },
            } as StreamEvent);
          }
        }
        break;

      case "item.completed":
        this.streamedTurnItems.push(event.item);

        if (event.item.type === "agent_message") {
          // Use "model" type for custom output_text_done events
          events.push({
            type: "model",
            event: {
              type: "output_text_done",
              text: event.item.text,
            },
          } as StreamEvent);
          textAccumulator.delete("agent_message");
          this.lastStreamedMessage = event.item.text;
        } else if (event.item.type === "reasoning") {
          events.push({
            type: "model",
            event: {
              type: "reasoning_done",
              reasoning: event.item.text,
            },
          } as StreamEvent);
          textAccumulator.delete("reasoning");
        }
        break;

      case "turn.completed":
        // Emit response done with full response
        const usage = this.convertUsage(event.usage);
        const responseId = this.thread?.id ?? "codex-stream-response";
        const response = this.buildStreamResponse(
          usage,
          responseId,
          this.streamedTurnItems,
          this.lastStreamedMessage
        );
        this.streamedTurnItems = [];
        this.lastStreamedMessage = null;

        events.push({
          type: "response_done",
          response,
        } as StreamEvent);
        break;

      case "turn.failed":
        events.push({
          type: "model",
          event: {
            type: "error",
            error: {
              message: event.error.message,
            },
          },
        } as StreamEvent);
        break;

      case "error":
        events.push({
          type: "model",
          event: {
            type: "error",
            error: {
              message: event.message,
            },
          },
        } as StreamEvent);
        break;

      default:
        // Unknown event type - skip
        break;
    }

    return events;
  }
}
