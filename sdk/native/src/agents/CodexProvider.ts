import type { Codex } from "../codex";
import type { Thread } from "../thread";
import type { ThreadEvent, Usage as CodexUsage } from "../events";
import type { ThreadItem } from "../items";
import type { Input, UserInput } from "../thread";
import type { CodexOptions } from "../codexOptions";
import type { ThreadOptions } from "../threadOptions";
import type {
  ModelProvider,
  Model,
  ModelRequest,
  ModelResponse,
  StreamEvent,
  AgentInputItem,
  AgentOutputItem,
  Usage,
  AssistantMessageItem,
  OutputText,
} from "./types";

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
}

/**
 * Provider implementation that uses Codex as the backend for OpenAI Agents
 *
 * @example
 * ```typescript
 * import { CodexProvider } from '@openai/codex-native/agents';
 * import { Agent, Runner } from '@openai/agents';
 *
 * const provider = new CodexProvider({
 *   apiKey: process.env.CODEX_API_KEY,
 *   defaultModel: 'claude-sonnet-4.5'
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
      // Dynamic import to avoid circular dependencies
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Codex: CodexClass } = require("../codex");
      this.codex = new CodexClass({
        apiKey: this.options.apiKey,
        baseUrl: this.options.baseUrl,
      }) as Codex;
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

  constructor(codex: Codex, modelName: string | undefined, options: CodexProviderOptions) {
    this.codex = codex;
    this.modelName = modelName;
    this.options = options;
  }

  /**
   * Get or create the thread for this model instance
   */
  private getThread(conversationId?: string): Thread {
    if (conversationId && !this.thread) {
      // Resume existing thread
      this.thread = this.codex.resumeThread(conversationId, this.getThreadOptions());
    } else if (!this.thread) {
      // Create new thread
      this.thread = this.codex.startThread(this.getThreadOptions());
    }
    return this.thread;
  }

  private getThreadOptions(): ThreadOptions {
    return {
      model: this.modelName,
      workingDirectory: this.options.workingDirectory,
      skipGitRepoCheck: this.options.skipGitRepoCheck,
    };
  }

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    const thread = this.getThread(request.conversationId || request.previousResponseId);
    const input = this.convertRequestToInput(request);

    // Run Codex (it handles tools internally)
    const turn = await thread.run(input, {
      outputSchema: request.outputType?.schema,
    });

    // Convert Codex response to ModelResponse format
    return {
      usage: this.convertUsage(turn.usage),
      output: this.convertItemsToOutput(turn.items, turn.finalResponse),
      responseId: thread.id || undefined,
    };
  }

  async *getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    const thread = this.getThread(request.conversationId || request.previousResponseId);
    const input = this.convertRequestToInput(request);

    const { events } = await thread.runStreamed(input, {
      outputSchema: request.outputType?.schema,
    });

    let accumulatedText = "";

    for await (const event of events) {
      const streamEvents = this.convertCodexEventToStreamEvent(event, accumulatedText);

      // Update accumulated text for text deltas
      if (event.type === "item.completed" && event.item.type === "agent_message") {
        accumulatedText = event.item.text;
      }

      for (const streamEvent of streamEvents) {
        yield streamEvent;
      }
    }
  }

  /**
   * Convert ModelRequest to Codex Input format
   */
  private convertRequestToInput(request: ModelRequest): Input {
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
        if (item.type === "input_text") {
          parts.push({ type: "text", text: item.text });
        } else if (item.type === "input_image") {
          // Handle image input
          if (typeof item.image === "string") {
            // Base64 or URL - we need to save to temp file for Codex
            // For now, skip images (TODO: implement temp file handling)
            continue;
          } else if ("url" in item.image) {
            // URL images - skip for now
            continue;
          } else if ("fileId" in item.image) {
            // File ID - skip for now
            continue;
          }
        }
        // Other input types (audio, files) are not yet supported
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
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      };
    }

    const inputTokensDetails = usage.cached_input_tokens
      ? [{ cachedTokens: usage.cached_input_tokens }]
      : undefined;

    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
      inputTokensDetails,
    };
  }

  /**
   * Convert Codex ThreadItems to AgentOutputItems
   */
  private convertItemsToOutput(items: ThreadItem[], finalResponse: string): AgentOutputItem[] {
    const output: AgentOutputItem[] = [];

    for (const item of items) {
      switch (item.type) {
        case "agent_message": {
          const content: OutputText[] = [
            {
              type: "output_text",
              text: item.text,
            },
          ];

          output.push({
            type: "message",
            role: "assistant",
            status: "completed",
            content,
          } as any); // Using 'any' because our type definition has 'assistant_message' but the framework expects 'message'
          break;
        }

        case "reasoning": {
          output.push({
            type: "reasoning",
            reasoning: item.text,
          });
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
            type: "output_text",
            text: finalResponse,
          },
        ],
      } as any);
    }

    return output;
  }

  /**
   * Convert Codex ThreadEvent to OpenAI Agents StreamEvent
   */
  private convertCodexEventToStreamEvent(
    event: ThreadEvent,
    previousText: string
  ): StreamEvent[] {
    const events: StreamEvent[] = [];

    switch (event.type) {
      case "thread.started":
        events.push({ type: "response_started" });
        break;

      case "turn.started":
        // No equivalent in StreamEvent - skip
        break;

      case "item.started":
        // Could emit output_text_delta if we had partial text
        break;

      case "item.completed":
        if (event.item.type === "agent_message") {
          // Emit text done event
          events.push({
            type: "output_text_done",
            text: event.item.text,
          });
        } else if (event.item.type === "reasoning") {
          events.push({
            type: "reasoning_done",
            reasoning: event.item.text,
          });
        }
        break;

      case "turn.completed":
        // Emit response done with full response
        events.push({
          type: "response_done",
          response: {
            usage: this.convertUsage(event.usage),
            output: [], // Items were already emitted
            responseId: this.thread?.id || undefined,
          },
        });
        break;

      case "turn.failed":
        events.push({
          type: "error",
          error: {
            message: event.error.message,
          },
        });
        break;

      default:
        // Unknown event type - skip
        break;
    }

    return events;
  }
}
