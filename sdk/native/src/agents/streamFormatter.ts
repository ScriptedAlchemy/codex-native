import type { StreamEvent } from "./types";

type UsageObject = {
  inputTokensDetails?: Array<Record<string, number>>;
  outputTokensDetails?: Array<Record<string, number>>;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type ModelEvent = {
  type?: string;
  delta?: string;
  reasoning?: string;
  error?: { message?: string };
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
};

export type ToolCallEvent = {
  name?: string;
  input?: unknown;
  output?: unknown;
  status?: "started" | "completed";
};

export type FormattedStream = {
  text: string;
  reasoning: string;
  toolCalls: ToolCallEvent[];
  usage?: {
    requests?: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    inputTokensDetails?: Record<string, number>;
    outputTokensDetails?: Record<string, number>;
  };
  /**
   * Convenience field when providers report cached tokens (e.g. via inputTokensDetails.cachedTokens)
   */
  cachedTokens?: number;
  responseId?: string;
  /**
   * Raw provider-specific data (e.g., costs, cache hit ratios, rate limit info)
   */
  providerData?: Record<string, unknown>;
  errors: { message: string }[];
};

export type FormatStreamOptions = {
  onUpdate?: (partial: Partial<FormattedStream>) => void;
};

/**
 * Consume a stream of StreamEvent and aggregate into a coherent object:
 * - Concatenates output_text deltas into `text`
 * - Concatenates reasoning deltas into `reasoning`
 * - Captures usage and responseId on response_done
 * - Prepares space for tool call events (future-friendly; empty for now)
 *
 * Optionally invokes `onUpdate` with partial snapshots as data arrives.
 */
export async function formatStream(
  stream: AsyncIterable<StreamEvent>,
  options: FormatStreamOptions = {},
): Promise<FormattedStream> {
  const state: FormattedStream = {
    text: "",
    reasoning: "",
    toolCalls: [],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    errors: [],
  };

  for await (const event of stream) {
    switch (event.type) {
      case "response_started":
        // emit initial usage snapshot
        options.onUpdate?.({ usage: state.usage });
        break;
      case "output_text_delta":
        state.text += event.delta;
        options.onUpdate?.({ text: state.text });
        break;
      case "model": {
        const e = (event as { event?: unknown }).event as ModelEvent;
        if (e && typeof e === "object") {
          if (e.type === "reasoning_delta" && typeof e.delta === "string") {
            state.reasoning += e.delta;
            options.onUpdate?.({ reasoning: state.reasoning });
          } else if (e.type === "reasoning_done" && typeof e.reasoning === "string") {
            // Ensure final reasoning is reflected (prefer completed text if provided)
            state.reasoning = e.reasoning || state.reasoning;
            options.onUpdate?.({ reasoning: state.reasoning });
          } else if (e.type === "error" && e.error && typeof e.error.message === "string") {
            state.errors.push({ message: e.error.message });
            options.onUpdate?.({ errors: state.errors.slice() });
          } else if (typeof e.type === "string" && e.type.startsWith("tool_")) {
            // Future-friendly hook for tool events if surfaced via "model" channel
            state.toolCalls.push({
              name: e.name,
              input: e.input,
              output: e.output,
              status: e.status === "started" || e.status === "completed" ? e.status : undefined,
            });
            options.onUpdate?.({ toolCalls: state.toolCalls.slice() });
          }
        }
        break;
      }
      case "response_done":
        state.responseId = event.response.id;
        // Normalize usage into a plain object and compute cachedTokens if present
        {
          const u = event.response.usage as UsageObject;
          // Merge details arrays (agents-core uses arrays for details)
          const mergeDetails = (arr?: Array<Record<string, number>>): Record<string, number> | undefined => {
            if (!arr || arr.length === 0) return undefined;
            const out: Record<string, number> = {};
            for (const rec of arr) {
              for (const [k, v] of Object.entries(rec)) {
                out[k] = (out[k] ?? 0) + (typeof v === "number" ? v : 0);
              }
            }
            return out;
          };
          const inputDetails = mergeDetails(u.inputTokensDetails);
          const outputDetails = mergeDetails(u.outputTokensDetails);
          state.usage = {
            requests: u.requests,
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            totalTokens: u.totalTokens ?? 0,
            inputTokensDetails: inputDetails,
            outputTokensDetails: outputDetails,
          };
          state.cachedTokens = inputDetails?.cachedTokens ?? state.cachedTokens;
        }
        // Provider-specific data passthrough (may include cost, cache stats, etc.)
        if (event.response.providerData && typeof event.response.providerData === "object") {
          state.providerData = event.response.providerData as Record<string, unknown>;
          options.onUpdate?.({ providerData: state.providerData });
        }
        options.onUpdate?.({ responseId: state.responseId, usage: state.usage, cachedTokens: state.cachedTokens });
        break;
      default:
        // ignore unknown events
        break;
    }
  }

  return state;
}


