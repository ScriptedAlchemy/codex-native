import { performance } from "node:perf_hooks";

import {
  reverieSearchSemantic,
  type ReverieSearchResult,
  type ReverieSemanticSearchOptions,
} from "@codex-native/sdk";

import type { ReasoningSlice } from "./dataset";

export type SearchStrategy = {
  id: string;
  label: string;
  description: string;
  buildQuery: (slice: ReasoningSlice) => string | null;
};

export type StrategyRun = {
  strategy: SearchStrategy;
  query?: string;
  skipped: boolean;
  skipReason?: string;
  results: ReverieSearchResult[];
  durationMs?: number;
  autoScore: {
    matchedSourceConversation: boolean;
    sourceRank?: number;
  };
  error?: string;
};

export const DEFAULT_STRATEGIES: SearchStrategy[] = [
  {
    id: "user_prompt",
    label: "User Prompt Anchor",
    description: "Search embeddings using the original user request.",
    buildQuery: (slice) => (slice.userMessage ? `User task:\n${slice.userMessage}` : null),
  },
  {
    id: "reasoning_focus",
    label: "Reasoning Token Focus",
    description: "Search using the agent's reasoning excerpt directly.",
    buildQuery: (slice) => slice.reasoningText,
  },
  {
    id: "assistant_reply",
    label: "Assistant Response",
    description: "Search based on the assistant's final response text.",
    buildQuery: (slice) => slice.assistantResponse ?? null,
  },
];

export type ExecuteStrategyOptions = {
  codexHome: string;
  slice: ReasoningSlice;
  strategy: SearchStrategy;
  searchOptions: ReverieSemanticSearchOptions;
  maxResults: number;
};

export async function executeStrategy(options: ExecuteStrategyOptions): Promise<StrategyRun> {
  const { codexHome, slice, strategy, searchOptions, maxResults } = options;
  const baseRun: StrategyRun = {
    strategy,
    skipped: false,
    results: [],
    autoScore: { matchedSourceConversation: false },
  };

  const query = strategy.buildQuery(slice);
  if (!query || query.trim().length === 0) {
    return {
      ...baseRun,
      skipped: true,
      skipReason: "No query text available for this slice.",
    };
  }

  const timerStart = performance.now();
  try {
    const mergedOptions: ReverieSemanticSearchOptions = {
      ...searchOptions,
      limit: maxResults,
    };
    const results = await reverieSearchSemantic(codexHome, query, mergedOptions);
    const trimmed = results.slice(0, maxResults);

    const sourceRankIndex = trimmed.findIndex((result) => result.conversation.id === slice.conversationId);
    return {
      ...baseRun,
      query,
      results: trimmed,
      durationMs: performance.now() - timerStart,
      autoScore: {
        matchedSourceConversation: sourceRankIndex >= 0,
        sourceRank: sourceRankIndex >= 0 ? sourceRankIndex + 1 : undefined,
      },
    };
  } catch (error) {
    return {
      ...baseRun,
      query,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function clipText(value: string | undefined, maxLength = 220): string | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

