/**
 * Advanced Reverie Search
 *
 * Provides semantic search over past conversation history with sophisticated filtering:
 * - 3x candidate multiplier for aggressive filtering
 * - Reranker support for improved precision
 * - Multi-stage filtering with transparent logging
 * - Quality and deduplication pipelines
 */

import { reverieSearchSemantic, reverieSearchConversations } from "../nativeBinding.js";
import type { ReverieSemanticSearchOptions, ReverieSearchResult } from "../nativeBinding.js";
import type { ReverieInsight, ReverieSearchOptions } from "./types.js";
import { isValidReverieExcerpt, deduplicateReverieInsights } from "./quality.js";
import { filterBoilerplateInsights } from "./boilerplate.js";
import {
  DEFAULT_REVERIE_LIMIT,
  DEFAULT_REVERIE_MAX_CANDIDATES,
  REVERIE_CANDIDATE_MULTIPLIER,
  REVERIE_RERANKER_MODEL,
  DEFAULT_RERANKER_TOP_K,
  DEFAULT_RERANKER_BATCH_SIZE,
} from "./constants.js";
import { searchEpisodeSummaries } from "./episodes.js";

/**
 * Performs advanced semantic search over reverie conversation history.
 *
 * Search pipeline:
 * 1. Fetch 3x candidates (candidateMultiplier × limit)
 * 2. Apply quality filtering (remove boilerplate, system prompts)
 * 3. Deduplicate similar excerpts (keep highest relevance)
 * 4. Apply reranker if enabled (improve precision)
 * 5. Return top N results
 *
 * Key features:
 * - Aggressive candidate fetching for better filtering headroom
 * - Optional reranker support for precision improvement
 * - Quality filtering removes system prompts and boilerplate
 * - Deduplication preserves highest-relevance duplicates
 * - Transparent logging at each stage
 *
 * @param codexHome - Path to .codex directory containing conversation data
 * @param text - Search query text
 * @param repo - Repository root path for filtering conversations
 * @param options - Search configuration options
 * @returns Array of relevant reverie insights, sorted by relevance
 *
 * @example
 * ```typescript
 * const insights = await searchReveries(
 *   "/Users/me/.codex",
 *   "authentication bug with JWT tokens",
 *   "/Users/me/my-project",
 *   {
 *     limit: 6,
 *     useReranker: true,
 *     candidateMultiplier: 3
 *   }
 * );
 *
 * console.log(`Found ${insights.length} relevant insights`);
 * insights.forEach(insight => {
 *   console.log(`[${insight.relevance.toFixed(2)}] ${insight.excerpt.slice(0, 100)}`);
 * });
 * ```
 */
export async function searchReveries(
  codexHome: string,
  text: string,
  repo: string,
  options?: ReverieSearchOptions
): Promise<ReverieInsight[]> {
  const {
    limit = DEFAULT_REVERIE_LIMIT,
    maxCandidates = DEFAULT_REVERIE_MAX_CANDIDATES,
    useReranker = true,
    rerankerModel = REVERIE_RERANKER_MODEL,
    rerankerTopK = DEFAULT_RERANKER_TOP_K,
    rerankerBatchSize = DEFAULT_RERANKER_BATCH_SIZE,
    candidateMultiplier = REVERIE_CANDIDATE_MULTIPLIER,
  } = options || {};

  // Normalize and validate input
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  // Configure search with aggressive candidate fetching
  const searchOptions: ReverieSemanticSearchOptions = {
    projectRoot: repo,
    limit: maxCandidates * candidateMultiplier, // Get 3x candidates for heavy filtering
    maxCandidates: maxCandidates * candidateMultiplier,
    normalize: true,
    cache: true,
  };

  // Add reranker if enabled
  if (useReranker) {
    searchOptions.rerankerModel = rerankerModel as any;
    searchOptions.rerankerTopK = rerankerTopK;
    searchOptions.rerankerBatchSize = rerankerBatchSize;
  }

  try {
    // Execute semantic search
    const regexMatches = looksLikeStructuredQuery(normalized)
      ? await reverieSearchConversations(codexHome, normalized, limit).catch(() => [])
      : [];

    const matches = await reverieSearchSemantic(codexHome, normalized, searchOptions);
    const combinedMatches = mergeSearchResults(regexMatches, matches);

    // Convert search results to insights
    const insights = convertSearchResultsToInsights(combinedMatches);

    // Apply quality filtering
    const validInsights = insights.filter((insight) => isValidReverieExcerpt(insight.excerpt));

    const { kept: conversational } = await filterBoilerplateInsights(validInsights, {
      projectRoot: repo,
    });

    // Deduplicate similar excerpts (keeps highest relevance)
    const deduplicated = deduplicateReverieInsights(conversational);

    const episodeMatches = await searchEpisodeSummaries(codexHome, normalized, repo, limit * 4).catch(() => []);
    const episodeBoost = new Map<string, number>();
    for (const episode of episodeMatches) {
      episodeBoost.set(episode.conversationId, Math.max(episodeBoost.get(episode.conversationId) ?? 0, episode.importance ?? 0));
    }

    const ranked = deduplicated
      .map((insight) => {
        const bonus = episodeBoost.get(insight.conversationId) ?? 0;
        return {
          insight,
          score: insight.relevance + bonus / 10,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ insight }) => insight);

    return ranked;
  } catch (error) {
    console.warn(
      `Reverie search failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Converts native search results to standardized ReverieInsight format.
 *
 * @param results - Raw search results from reverieSearchSemantic
 * @returns Array of ReverieInsight objects
 */
function convertSearchResultsToInsights(results: ReverieSearchResult[]): ReverieInsight[] {
  const flattened: ReverieInsight[] = [];

  for (const match of results) {
    const base: ReverieInsight = {
      conversationId: match.conversation?.id || "unknown",
      timestamp: match.conversation?.createdAt || match.conversation?.updatedAt || new Date().toISOString(),
      relevance: typeof match.relevanceScore === "number" ? match.relevanceScore : 0,
      excerpt: "",
      insights: Array.isArray(match.insights) ? match.insights : [],
    };

    const excerpts = match.matchingExcerpts?.length ? match.matchingExcerpts : [""];
    for (const excerpt of excerpts) {
      if (!excerpt.trim()) {
        continue;
      }
      flattened.push({ ...base, excerpt });
    }
  }

  return flattened;
}

function mergeSearchResults(primary: ReverieSearchResult[], secondary: ReverieSearchResult[]): ReverieSearchResult[] {
  const seen = new Set<string>();
  const merged: ReverieSearchResult[] = [];

  for (const list of [primary, secondary]) {
    for (const match of list) {
      const convoId = match.conversation?.id || "unknown";
      const excerptKey = match.matchingExcerpts?.[0] || String(match.relevanceScore ?? 0);
      const key = `${convoId}:${excerptKey}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(match);
    }
  }

  return merged;
}

function looksLikeStructuredQuery(text: string): boolean {
  if (!text) {
    return false;
  }

  const structuredPatterns = [
    /traceback \(most recent call last\)/i, // Python
    /exception in thread/i,
    /java\.lang\./i,
    /org\.junit/i,
    /at\s+org\./i,
    /AssertionError:/i,
    /panic!|thread '.+' panicked/i,
    /FAIL\s+\S+\s+\(/i, // Jest/Vitest
    /(?:error|fail|fatal):/i,
    /Caused by:/i,
    /\bundefined reference to\b/i,
  ];

  for (const pattern of structuredPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  const hashPattern = /\b[0-9a-f]{32,}\b/i; // commit or build IDs
  if (hashPattern.test(text)) {
    return true;
  }

  const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
  if (uuidPattern.test(text)) {
    return true;
  }

  const stackFrameMatches = text.match(/\bat\s+[^\s]+\s*\(|\b\S+\.\w+:\d+/gi);
  if ((stackFrameMatches?.length ?? 0) >= 2) {
    return true;
  }

  const severityTokens = text.match(/\b(?:fail|error|panic|assert|fatal)\b/gi)?.length ?? 0;
  if (severityTokens >= 3 && text.length > 50) {
    return true;
  }

  return false;
}
